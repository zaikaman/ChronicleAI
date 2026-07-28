// Digest event selection service: type-diverse selection for daily digests

import type { MonitoredEventRepository, MonitoredEventRow } from "@chronicleai/db";

export interface EventSelectionResult {
  events: Array<{
    id: string;
    eventType: string;
    chainId: number;
    protocol: string | null;
    assetSymbols: string[] | null;
    magnitude: Record<string, unknown> | null;
    transactionHash: string | null;
    significanceScore: number | null;
    capturedAt: string;
    rawPayload?: Record<string, unknown> | null;
  }>;
  totalEvents: number;
  qualifiedEvents: number;
}

export interface DigestEventSelectionService {
  /** Select a type-diverse set of top events in a reporting window. */
  selectEvents(params: {
    periodStart: string;
    periodEnd: string;
    maxEvents?: number;
  }): Promise<EventSelectionResult>;
}

/** Priority buckets for diversity — ensure at least one of each when present. */
const DIVERSITY_PRIORITY: readonly string[] = [
  "liquidation_cluster",
  "cex_inflow",
  "cex_outflow",
  "stablecoin_mint",
  "stablecoin_burn",
  "protocol_deposit",
  "protocol_withdraw",
  "liquidation",
  "gas_spike",
  "volume_anomaly",
  "large_swap",
];

/** Cap share of large_swap in the selected set (e.g. 40%). */
const MAX_SWAP_SHARE = 0.4;

function mapEvent(e: MonitoredEventRow) {
  return {
    id: e.id,
    eventType: e.event_type,
    chainId: e.chain_id,
    protocol: e.protocol,
    assetSymbols: e.asset_symbols,
    magnitude: e.magnitude,
    transactionHash: e.transaction_hash,
    significanceScore: e.significance_score,
    capturedAt: e.captured_at,
    rawPayload: (e.raw_payload as Record<string, unknown> | null) ?? null,
  };
}

function scoreOf(e: MonitoredEventRow): number {
  return e.significance_score ?? 0;
}

/**
 * Select events with type diversity:
 * 1. Always include the best example of each priority type when present
 * 2. Cap large_swap at MAX_SWAP_SHARE of the final set
 * 3. Fill remaining slots by significance score
 */
export function selectDiverseEvents(
  windowEvents: MonitoredEventRow[],
  maxEvents: number,
): MonitoredEventRow[] {
  if (windowEvents.length === 0 || maxEvents <= 0) return [];

  const sorted = [...windowEvents].sort((a, b) => scoreOf(b) - scoreOf(a));
  const selected: MonitoredEventRow[] = [];
  const selectedIds = new Set<string>();

  const pick = (e: MonitoredEventRow) => {
    if (selectedIds.has(e.id)) return;
    if (selected.length >= maxEvents) return;
    selected.push(e);
    selectedIds.add(e.id);
  };

  // 1. Best of each diversity type
  for (const type of DIVERSITY_PRIORITY) {
    const best = sorted.find((e) => e.event_type === type);
    if (best) pick(best);
  }

  // 2. Fill by score with swap cap (~40% of selected set)
  const maxSwaps = Math.max(1, Math.ceil(maxEvents * MAX_SWAP_SHARE));
  let swapCount = selected.filter((e) => e.event_type === "large_swap").length;

  for (const e of sorted) {
    if (selected.length >= maxEvents) break;
    if (selectedIds.has(e.id)) continue;
    if (e.event_type === "large_swap") {
      if (swapCount >= maxSwaps) continue;
      swapCount += 1;
    }
    pick(e);
  }

  // 3. Fill remaining non-swap events (preserve diversity preference)
  if (selected.length < maxEvents) {
    for (const e of sorted) {
      if (selected.length >= maxEvents) break;
      if (selectedIds.has(e.id)) continue;
      if (e.event_type === "large_swap") continue;
      pick(e);
    }
  }

  // 4. Swap-only (or swap-dominated) tape: fill leftover slots without the cap
  const hasNonSwapRemaining = sorted.some(
    (e) => e.event_type !== "large_swap" && !selectedIds.has(e.id),
  );
  if (selected.length < maxEvents && !hasNonSwapRemaining) {
    for (const e of sorted) {
      if (selected.length >= maxEvents) break;
      pick(e);
    }
  }

  return selected;
}

export function createDigestEventSelectionService(
  eventRepo: MonitoredEventRepository,
): DigestEventSelectionService {
  return {
    async selectEvents({ periodStart, periodEnd, maxEvents = 10 }) {
      // Prefer window query when available; fall back to list+filter
      const windowResult = await eventRepo.listInWindow({
        periodStart,
        periodEnd,
        status: "qualified",
        limit: 500,
      });

      let windowEvents: MonitoredEventRow[] = [];

      if (windowResult.ok) {
        windowEvents = windowResult.value;
      } else {
        const result = await eventRepo.list({
          status: "qualified",
          limit: 100,
        });
        if (!result.ok) {
          return { events: [], totalEvents: 0, qualifiedEvents: 0 };
        }
        const windowStart = new Date(periodStart).getTime();
        const windowEnd = new Date(periodEnd).getTime();
        windowEvents = result.value.filter((e: MonitoredEventRow) => {
          const capturedAt = new Date(e.captured_at).getTime();
          return capturedAt >= windowStart && capturedAt <= windowEnd;
        });
      }

      // Also count all statuses in window for totalEvents context
      const allInWindow = await eventRepo.listInWindow({
        periodStart,
        periodEnd,
        limit: 500,
      });
      const totalEvents = allInWindow.ok ? allInWindow.value.length : windowEvents.length;
      const qualifiedEvents = windowEvents.length;

      const selected = selectDiverseEvents(windowEvents, maxEvents).map(mapEvent);

      return { events: selected, totalEvents, qualifiedEvents };
    },
  };
}
