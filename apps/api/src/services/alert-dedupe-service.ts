// Alert deduplication service: prevents duplicate alerts for the same event
// and rate-limits publication by flow clusterKey within an hour bucket.

import { ALERT_CLUSTER_DEDUPE_WINDOW_MS, DEDUPE_WINDOW_MS } from "@chronicleai/config";
import type { EventType } from "@chronicleai/schemas";

/** Event types that participate in cluster-key publication rate limiting. */
const CLUSTER_DEDUPE_TYPES = new Set<EventType>([
  "large_swap",
  "cex_inflow",
  "cex_outflow",
  "protocol_deposit",
  "protocol_withdraw",
]);

export interface AlertDedupeService {
  /**
   * Generate a deduplication key for a monitored event.
   * When clusterKey is present for flow types, keys by hour-bucket so
   * raw events still store uniquely but public alerts rate-limit.
   */
  generateDedupeKey(params: {
    sourceEventId?: string | null;
    source: string;
    eventType: EventType;
    clusterKey?: string | null;
    capturedAt?: string | null;
  }): string;

  /**
   * Check if a dedupe key is within the valid deduplication window.
   * Cluster-key keys use the shorter 60m window; source-event keys use 24h.
   */
  isWithinWindow(createdAt: string, options?: { clusterScoped?: boolean }): boolean;
}

function hourBucket(iso: string | null | undefined): string {
  const ms = iso ? new Date(iso).getTime() : Date.now();
  const t = Number.isFinite(ms) ? ms : Date.now();
  const hourStart = Math.floor(t / 3_600_000) * 3_600_000;
  return new Date(hourStart).toISOString();
}

export function createAlertDedupeService(): AlertDedupeService {
  return {
    generateDedupeKey({ sourceEventId, source, eventType, clusterKey, capturedAt }) {
      // Publication rate-limit by cluster for high-volume flow types
      if (clusterKey && CLUSTER_DEDUPE_TYPES.has(eventType)) {
        const bucket = hourBucket(capturedAt);
        return `${source}-cluster-${eventType}-${clusterKey}-${bucket}`;
      }

      // liquidation_cluster already has stable windowed sourceEventId
      if (sourceEventId) {
        return `${source}-${sourceEventId}-${eventType}`;
      }

      return `${source}-${eventType}-${Date.now()}`;
    },

    isWithinWindow(createdAt, options) {
      const created = new Date(createdAt).getTime();
      const now = Date.now();
      const window = options?.clusterScoped
        ? ALERT_CLUSTER_DEDUPE_WINDOW_MS
        : DEDUPE_WINDOW_MS;
      return now - created < window;
    },
  };
}
