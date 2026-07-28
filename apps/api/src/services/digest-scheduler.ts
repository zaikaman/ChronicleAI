// In-process daily digest scheduler.
// Wakes on an interval, and when the previous UTC day is ready, runs
// DigestRunHandler for that window. Duplicate windows are no-ops (202).

import type { DigestRunHandler } from "../keeperhub/digest-run-handler.ts";
import {
  computePreviousUtcDayWindow,
  isPreviousUtcDayWindowReady,
} from "./digest-schedule-service.ts";

export type DigestSchedulerOptions = {
  handler: DigestRunHandler;
  /** Check interval in ms. */
  intervalMs: number;
  /** Grace minutes after UTC midnight before generating yesterday's digest. */
  graceMinutes?: number;
  /** Optional clock for tests. */
  now?: () => Date;
  /** Optional logger hooks (default console). */
  log?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
};

export type DigestSchedulerHandle = {
  /** Run one check immediately (does not start the interval). */
  tick: () => Promise<void>;
  /** Start interval ticks. Safe to call once. */
  start: () => void;
  /** Clear the interval. */
  stop: () => void;
};

/**
 * Create an in-process scheduler that generates the previous UTC day's digest.
 */
export function createDigestScheduler(
  options: DigestSchedulerOptions,
): DigestSchedulerHandle {
  const log = options.log ?? console;
  const nowFn = options.now ?? (() => new Date());
  let timer: ReturnType<typeof setInterval> | undefined;
  let inFlight = false;

  const tick = async (): Promise<void> => {
    if (inFlight) {
      return;
    }
    inFlight = true;
    try {
      const now = nowFn();
      if (!isPreviousUtcDayWindowReady(now, options.graceMinutes)) {
        return;
      }

      const window = computePreviousUtcDayWindow(now);
      const result = await options.handler.runDigest(window, "scheduler");

      if (result.statusCode === 201) {
        log.info(
          `[digest-scheduler] generated digest ${result.digestId ?? "?"} for ${window.periodStart} → ${window.periodEnd}: ${result.message}`,
        );
      } else if (result.statusCode === 202) {
        // Expected most of the day after the first successful run — stay quiet
      } else {
        log.warn(
          `[digest-scheduler] status=${result.statusCode} accepted=${String(result.accepted)}: ${result.message}`,
        );
      }
    } catch (error) {
      log.error(
        `[digest-scheduler] tick failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      inFlight = false;
    }
  };

  return {
    tick,
    start() {
      if (timer) {
        return;
      }
      // Fire once shortly after boot so a late deploy still catches today's window
      void tick();
      timer = setInterval(() => {
        void tick();
      }, options.intervalMs);
      timer.unref?.();
      log.info(
        `[digest-scheduler] enabled (check every ${options.intervalMs}ms for previous UTC day)`,
      );
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}
