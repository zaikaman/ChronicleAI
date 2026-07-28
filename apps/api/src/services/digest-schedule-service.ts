// Daily digest scheduling helpers.
// Computes the previous completed UTC reporting window and decides when the
// in-process scheduler (or a KeeperHub/Telegram trigger) may generate it.

import {
  DIGEST_REPORTING_WINDOW_HOURS,
  DIGEST_SCHEDULE_GRACE_MINUTES,
} from "@chronicleai/config";

export type DigestReportingWindow = {
  periodStart: string;
  periodEnd: string;
};

/**
 * Previous completed UTC calendar day as [start, end) ISO bounds.
 *
 * Example at 2026-07-28T08:00:00.000Z:
 *   periodStart = 2026-07-28T00:00:00.000Z
 *   periodEnd   = 2026-07-28T00:00:00.000Z
 */
export function computePreviousUtcDayWindow(
  now: Date = new Date(),
  windowHours = DIGEST_REPORTING_WINDOW_HOURS,
): DigestReportingWindow {
  const periodEndMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0,
    0,
    0,
    0,
  );
  const periodStartMs = periodEndMs - windowHours * 60 * 60 * 1000;
  return {
    periodStart: new Date(periodStartMs).toISOString(),
    periodEnd: new Date(periodEndMs).toISOString(),
  };
}

/**
 * True once `graceMinutes` have elapsed after the previous UTC day closed
 * (i.e. after today's 00:00 UTC + grace).
 */
export function isPreviousUtcDayWindowReady(
  now: Date = new Date(),
  graceMinutes = DIGEST_SCHEDULE_GRACE_MINUTES,
): boolean {
  const startOfTodayUtcMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0,
    0,
    0,
    0,
  );
  const readyAt = startOfTodayUtcMs + graceMinutes * 60_000;
  return now.getTime() >= readyAt;
}

/**
 * Resolve a digest run window from either explicit ISO bounds or a named mode.
 * Supported modes: `previous_utc_day` (default when body is empty / mode only).
 */
export function resolveDigestRunWindow(
  input: {
    periodStart?: unknown;
    periodEnd?: unknown;
    window?: unknown;
  },
  now: Date = new Date(),
):
  | { ok: true; window: DigestReportingWindow; source: "explicit" | "previous_utc_day" }
  | { ok: false; error: string } {
  const hasStart =
    typeof input.periodStart === "string" && input.periodStart.trim().length > 0;
  const hasEnd =
    typeof input.periodEnd === "string" && input.periodEnd.trim().length > 0;

  if (hasStart || hasEnd) {
    if (!hasStart || !hasEnd) {
      return {
        ok: false,
        error: "periodStart and periodEnd must both be provided when either is set",
      };
    }
    return {
      ok: true,
      window: {
        periodStart: String(input.periodStart).trim(),
        periodEnd: String(input.periodEnd).trim(),
      },
      source: "explicit",
    };
  }

  const mode =
    typeof input.window === "string" && input.window.trim().length > 0
      ? input.window.trim()
      : "previous_utc_day";

  if (mode === "previous_utc_day") {
    return {
      ok: true,
      window: computePreviousUtcDayWindow(now),
      source: "previous_utc_day",
    };
  }

  return {
    ok: false,
    error: `Unsupported window mode "${mode}" (supported: previous_utc_day)`,
  };
}
