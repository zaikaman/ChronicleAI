// In-process Loop 5 revenue-routing scheduler.
// Complements KeeperHub-signed POST /keeperhub/revenue/route. The routing
// service still enforces ROUTING_INTERVAL_MS + safety buffer / skip reasons.

import type { RevenueRoutingHandler } from "../keeperhub/revenue-routing-handler.ts";

export type RevenueRoutingSchedulerOptions = {
  handler: RevenueRoutingHandler;
  /** Wake interval in ms. */
  intervalMs: number;
  /** Optional clock for tests. */
  now?: () => Date;
  log?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
};

export type RevenueRoutingSchedulerHandle = {
  tick: () => Promise<void>;
  start: () => void;
  stop: () => void;
};

/**
 * Create an in-process scheduler that attempts Loop 5 revenue routing.
 */
export function createRevenueRoutingScheduler(
  options: RevenueRoutingSchedulerOptions,
): RevenueRoutingSchedulerHandle {
  const log = options.log ?? console;
  const nowFn = options.now ?? (() => new Date());
  let timer: ReturnType<typeof setInterval> | undefined;
  let inFlight = false;

  const tick = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      const periodHash = `scheduler_${nowFn().toISOString().slice(0, 10)}_${Math.floor(nowFn().getTime() / options.intervalMs)}`;
      const result = await options.handler.route({ periodHash, force: false }, "scheduler");

      if (result.payoutCount > 0) {
        log.info(`[revenue-scheduler] ${result.message} (payouts=${result.payoutCount})`);
      } else if (result.accepted && result.message.includes("skipped")) {
        // Quiet expected skips (buffer / interval)
      } else if (!result.accepted) {
        log.warn(`[revenue-scheduler] ${result.message}`);
      }
    } catch (error) {
      log.error(
        `[revenue-scheduler] tick failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      inFlight = false;
    }
  };

  return {
    tick,
    start() {
      if (timer !== undefined) return;
      // Delay first tick slightly so boot-time Para warm-up can complete.
      timer = setInterval(() => {
        void tick();
      }, options.intervalMs);
      timer.unref?.();
      log.info(
        `[revenue-scheduler] started (wake every ${options.intervalMs}ms; routing still gated by ROUTING_INTERVAL_MS)`,
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
