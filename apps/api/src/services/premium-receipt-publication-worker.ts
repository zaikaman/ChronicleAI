import type {
  PaymentRecordRepository,
  PaymentRecordRow,
  PremiumIntelligenceRepository,
  PremiumIntelligenceItemRow,
} from "@chronicleai/db";
import type { PremiumReceiptPublicationService } from "./premium-receipt-publication-service.ts";

export interface PremiumReceiptPublicationWorkerStats {
  attempted: number;
  succeeded: number;
  failed: number;
}

export interface PremiumReceiptPublicationWorker {
  /** Enqueue a newly settled payment without delaying its HTTP response. */
  enqueue(params: {
    payment: PaymentRecordRow;
    premiumItem: PremiumIntelligenceItemRow | null;
  }): void;
  /** Start the boot recovery scan and periodic retry loop. */
  start(): void;
  /** Stop the periodic retry loop during graceful shutdown. */
  stop(): void;
  /** Run one durable recovery scan. Primarily useful for tests and operators. */
  runOnce(): Promise<PremiumReceiptPublicationWorkerStats>;
}

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_BATCH_SIZE = 20;

/**
 * Publishes premium registry receipts outside the payment HTTP request.
 *
 * `payment_records.registry_tx_hash` is the durable completion marker. A
 * settled row without that proof is retried on boot and every interval, so a
 * Heroku dyno restart cannot lose a receipt that was accepted by the API.
 */
export function createPremiumReceiptPublicationWorker(deps: {
  paymentRecordRepo: PaymentRecordRepository;
  premiumRepo: PremiumIntelligenceRepository;
  publisher: PremiumReceiptPublicationService;
  intervalMs?: number;
  batchSize?: number;
}): PremiumReceiptPublicationWorker {
  const intervalMs = Math.max(5_000, deps.intervalMs ?? DEFAULT_INTERVAL_MS);
  const batchSize = Math.min(100, Math.max(1, deps.batchSize ?? DEFAULT_BATCH_SIZE));
  const active = new Set<string>();
  const queued = new Map<
    string,
    { payment: PaymentRecordRow; premiumItem: PremiumIntelligenceItemRow | null }
  >();
  let timer: ReturnType<typeof setInterval> | null = null;
  let drainPromise: Promise<void> | null = null;

  async function process(payment: PaymentRecordRow, suppliedItem?: PremiumIntelligenceItemRow) {
    if (payment.registry_tx_hash || payment.status !== "settled" || active.has(payment.id)) {
      return { attempted: false, succeeded: false };
    }

    active.add(payment.id);
    try {
      let premiumItem: PremiumIntelligenceItemRow | null;
      if (suppliedItem !== undefined) {
        premiumItem = suppliedItem;
      } else {
        const itemResult = await deps.premiumRepo.findById(payment.premium_item_id);
        if (!itemResult.ok || !itemResult.value) {
          console.error(
            `[premium-receipt-worker] premium item unavailable payment=${payment.id} item=${payment.premium_item_id}`,
          );
          return { attempted: true, succeeded: false };
        }
        premiumItem = itemResult.value;
      }

      // Sponsored monitors have their own create/report publication trail.
      if (premiumItem?.content_type === "sponsored_monitor") {
        return { attempted: false, succeeded: false };
      }

      const result = await deps.publisher.publishForSettlement({
        payment,
        premiumItem,
      });
      return {
        attempted: result.attempted,
        succeeded: result.success,
      };
    } catch (error) {
      console.error(
        `[premium-receipt-worker] failed payment=${payment.id}:`,
        error instanceof Error ? error.message : error,
      );
      return { attempted: true, succeeded: false };
    } finally {
      active.delete(payment.id);
    }
  }

  async function drain(): Promise<void> {
    if (drainPromise) return drainPromise;

    drainPromise = (async () => {
      while (queued.size > 0) {
        const next = queued.entries().next().value as
          | [string, { payment: PaymentRecordRow; premiumItem: PremiumIntelligenceItemRow | null }]
          | undefined;
        if (!next) break;
        queued.delete(next[0]);
        await process(next[1].payment, next[1].premiumItem ?? undefined);
      }
    })().finally(() => {
      drainPromise = null;
    });

    return drainPromise;
  }

  async function runOnce(): Promise<PremiumReceiptPublicationWorkerStats> {
    const listPending = deps.paymentRecordRepo.listSettledWithoutRegistryProof;
    if (!listPending) {
      return { attempted: 0, succeeded: 0, failed: 0 };
    }

    const pendingResult = await listPending(batchSize);
    if (!pendingResult.ok) {
      console.error(
        "[premium-receipt-worker] pending scan failed:",
        pendingResult.error.message,
      );
      return { attempted: 0, succeeded: 0, failed: 1 };
    }

    const stats: PremiumReceiptPublicationWorkerStats = {
      attempted: 0,
      succeeded: 0,
      failed: 0,
    };
    for (const payment of pendingResult.value) {
      const result = await process(payment);
      if (result.attempted) stats.attempted += 1;
      if (result.succeeded) stats.succeeded += 1;
      if (result.attempted && !result.succeeded) stats.failed += 1;
    }
    return stats;
  }

  return {
    enqueue({ payment, premiumItem }) {
      if (payment.registry_tx_hash || payment.status !== "settled") return;
      if (active.has(payment.id) || queued.has(payment.id)) return;
      queued.set(payment.id, { payment, premiumItem });
      void drain().catch((error) => {
        console.error(
          `[premium-receipt-worker] queue drain failed payment=${payment.id}:`,
          error instanceof Error ? error.message : error,
        );
      });
    },

    start() {
      if (timer) return;
      void runOnce().then((stats) => {
        if (stats.attempted > 0) {
          console.info(
            `[premium-receipt-worker] boot scan attempted=${stats.attempted} succeeded=${stats.succeeded} failed=${stats.failed}`,
          );
        }
      });
      timer = setInterval(() => {
        void runOnce().then((stats) => {
          if (stats.attempted > 0) {
            console.info(
              `[premium-receipt-worker] retry attempted=${stats.attempted} succeeded=${stats.succeeded} failed=${stats.failed}`,
            );
          }
        });
      }, intervalMs);
      timer.unref?.();
    },

    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },

    runOnce,
  };
}
