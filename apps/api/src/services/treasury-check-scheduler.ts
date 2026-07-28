// In-process Loop 3 treasury-check scheduler (weekly by default).
// Complements KeeperHub-signed POST /keeperhub/treasury/check so the agent
// still records live Para balance + utility metrics without an external cron.

import type { TreasuryCheckHandler } from "../keeperhub/treasury-check-handler.ts";

export type TreasuryCheckSchedulerOptions = {
  handler: TreasuryCheckHandler;
  /** Wake interval in ms (how often we check whether a run is due). */
  intervalMs: number;
  /**
   * Minimum ms between successful snapshots from this scheduler.
   * Default product policy: weekly (7d).
   */
  minIntervalMs: number;
  /**
   * Optional payload balance used when live Para provider is unavailable.
   * Prefer live balance inside the handler.
   */
  fallbackBalance?: number;
  fallbackCurrency?: string;
  /** Optional clock for tests. */
  now?: () => Date;
  log?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  /**
   * Returns the ISO captured_at of the latest snapshot, or null.
   * Used to enforce minIntervalMs.
   */
  getLatestCapturedAt: () => Promise<string | null>;
};

export type TreasuryCheckSchedulerHandle = {
  tick: () => Promise<void>;
  start: () => void;
  stop: () => void;
};

/**
 * Create an in-process scheduler that runs Loop 3 treasury checks weekly.
 */
export function createTreasuryCheckScheduler(
  options: TreasuryCheckSchedulerOptions,
): TreasuryCheckSchedulerHandle {
  const log = options.log ?? console;
  const nowFn = options.now ?? (() => new Date());
  let timer: ReturnType<typeof setInterval> | undefined;
  let inFlight = false;

  const tick = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      const latest = await options.getLatestCapturedAt();
      if (latest) {
        const lastMs = Date.parse(latest);
        if (!Number.isNaN(lastMs)) {
          const elapsed = nowFn().getTime() - lastMs;
          if (elapsed < options.minIntervalMs) {
            return;
          }
        }
      }

      const capturedAt = nowFn().toISOString();
      const result = await options.handler.check(
        {
          capturedAt,
          availableBalance: options.fallbackBalance ?? 0,
          currency: options.fallbackCurrency ?? "ETH",
          safetyBuffer: 0.01,
        },
        "scheduler",
      );

      if (result.accepted) {
        log.info(
          `[treasury-scheduler] ${result.message}${result.snapshotId ? ` snapshot=${result.snapshotId}` : ""}`,
        );
      } else {
        log.warn(`[treasury-scheduler] rejected: ${result.message}`);
      }
    } catch (error) {
      log.error(
        `[treasury-scheduler] tick failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      inFlight = false;
    }
  };

  return {
    tick,
    start() {
      if (timer !== undefined) return;
      void tick();
      timer = setInterval(() => {
        void tick();
      }, options.intervalMs);
      timer.unref?.();
      log.info(
        `[treasury-scheduler] started (wake every ${options.intervalMs}ms, min gap ${options.minIntervalMs}ms)`,
      );
    },
    stop() {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}
