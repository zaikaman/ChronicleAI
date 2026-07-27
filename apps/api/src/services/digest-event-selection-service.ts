// Digest event selection service: selects the top monitored events for a reporting period

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
  }>;
  totalEvents: number;
  qualifiedEvents: number;
}

export interface DigestEventSelectionService {
  /** Select the top events in a reporting window. */
  selectEvents(params: {
    periodStart: string;
    periodEnd: string;
    maxEvents?: number;
  }): Promise<EventSelectionResult>;
}

export function createDigestEventSelectionService(
  eventRepo: MonitoredEventRepository,
): DigestEventSelectionService {
  return {
    async selectEvents({ periodStart, periodEnd, maxEvents = 10 }) {
      // List all qualified events in the period
      const result = await eventRepo.list({
        status: "qualified",
        limit: 100,
      });

      if (!result.ok) {
        return { events: [], totalEvents: 0, qualifiedEvents: 0 };
      }

      const allEvents = result.value;
      const totalEvents = allEvents.length;

      // Filter to the reporting window
      const windowStart = new Date(periodStart).getTime();
      const windowEnd = new Date(periodEnd).getTime();

      const windowEvents = allEvents.filter((e: MonitoredEventRow) => {
        const capturedAt = new Date(e.captured_at).getTime();
        return capturedAt >= windowStart && capturedAt <= windowEnd;
      });

      const qualifiedEvents = windowEvents.length;

      // Sort by significance score descending
      const sorted = [...windowEvents].sort((a: MonitoredEventRow, b: MonitoredEventRow) => {
        const scoreA = a.significance_score ?? 0;
        const scoreB = b.significance_score ?? 0;
        return scoreB - scoreA;
      });

      const selected = sorted.slice(0, maxEvents).map((e: MonitoredEventRow) => ({
        id: e.id,
        eventType: e.event_type,
        chainId: e.chain_id,
        protocol: e.protocol,
        assetSymbols: e.asset_symbols,
        magnitude: e.magnitude,
        transactionHash: e.transaction_hash,
        significanceScore: e.significance_score,
        capturedAt: e.captured_at,
      }));

      return { events: selected, totalEvents, qualifiedEvents };
    },
  };
}
