/**
 * CCTP rebalance worker — scheduled resume + policy tick.
 *
 * Cycle order (plan §8.3 / §5.4):
 *   1. resumeInFlight()  — advance awaiting_attestation | minting | stuck
 *   2. tick()            — maybe start a new burn when policy allows
 *
 * Safe to call from the desk scheduler as the first phase of the autonomy
 * loop, and/or from a dedicated interval timer.
 */

import type { CctpRebalanceService } from "./rebalance-service.ts";
import type { CctpResumeResult, CctpTickResult } from "./types.ts";
import { cctpLog } from "./log.ts";

export type CctpRebalanceWorkerOptions = {
  service: CctpRebalanceService;
  /** Wake interval in ms (default from env / 3m). */
  intervalMs: number;
  /**
   * When false, start() is a no-op (service may still be used via routes).
   * Default true.
   */
  enabled?: boolean;
  log?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
};

export type CctpCycleResult = {
  resume: CctpResumeResult;
  tick: CctpTickResult;
};

export type CctpRebalanceWorkerHandle = {
  /** Run resumeInFlight then tick (awaits completion). No-ops if already in flight. */
  cycle: () => Promise<CctpCycleResult | null>;
  start: () => void;
  stop: () => void;
  isInFlight: () => boolean;
};

/**
 * Create an in-process CCTP rebalance worker.
 */
export function createCctpRebalanceWorker(
  options: CctpRebalanceWorkerOptions,
): CctpRebalanceWorkerHandle {
  const log = options.log ?? console;
  let timer: ReturnType<typeof setInterval> | undefined;
  let inFlight = false;
  const enabled = options.enabled !== false;

  const cycle = async (): Promise<CctpCycleResult | null> => {
    if (inFlight) return null;
    inFlight = true;
    try {
      let resume: CctpResumeResult;
      try {
        resume = await options.service.resumeInFlight();
        if (resume.processed > 0) {
          log.info(
            `[cctp-worker] resume processed=${resume.processed}` +
              resume.results
                .map(
                  (r) =>
                    ` ${r.transferId.slice(0, 8)}…=${r.outcome}` +
                    (r.status ? `(${r.status})` : ""),
                )
                .join(""),
          );
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        log.error(`[cctp-worker] resume failed: ${message}`);
        cctpLog("error", "worker_resume_failed", { reason: message });
        resume = { processed: 0, results: [] };
      }

      let tick: CctpTickResult;
      try {
        tick = await options.service.tick();
        if (tick.outcome !== "skipped") {
          log.info(
            `[cctp-worker] tick outcome=${tick.outcome}` +
              (tick.reason ? ` reason=${tick.reason}` : "") +
              (tick.transferId ? ` transfer=${tick.transferId}` : "") +
              (tick.amountUsdc != null ? ` amountUsdc=${tick.amountUsdc}` : "") +
              (tick.burnTxHash ? ` burn=${tick.burnTxHash}` : "") +
              (tick.mintTxHash ? ` mint=${tick.mintTxHash}` : "") +
              (tick.errorMessage ? ` error=${tick.errorMessage}` : ""),
          );
        } else {
          log.info(
            `[cctp-worker] tick skipped` +
              (tick.reason ? ` reason=${tick.reason}` : ""),
          );
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        log.error(`[cctp-worker] tick failed: ${message}`);
        cctpLog("error", "worker_tick_failed", { reason: message });
        tick = { outcome: "error", errorMessage: message };
      }

      return { resume, tick };
    } finally {
      inFlight = false;
    }
  };

  return {
    cycle,
    isInFlight: () => inFlight,
    start() {
      if (!enabled) {
        log.info(
          "[cctp-worker] disabled (CCTP worker start skipped — routes may still call the service)",
        );
        return;
      }
      if (timer !== undefined) return;
      // Fire once on boot so in-flight transfers resume without waiting a full interval.
      void cycle();
      timer = setInterval(() => {
        void cycle();
      }, options.intervalMs);
      timer.unref?.();
      log.info(
        `[cctp-worker] started (wake every ${options.intervalMs}ms)`,
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
