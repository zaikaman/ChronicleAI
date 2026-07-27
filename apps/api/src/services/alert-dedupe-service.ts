// Alert deduplication service: prevents duplicate alerts for the same event

import { DEDUPE_WINDOW_MS } from "@chronicleai/config";
import type { EventType } from "@chronicleai/schemas";

export interface AlertDedupeService {
  /**
   * Generate a deduplication key for a monitored event.
   */
  generateDedupeKey(params: {
    sourceEventId?: string | null;
    source: string;
    eventType: EventType;
  }): string;

  /**
   * Check if a dedupe key is within the valid deduplication window.
   */
  isWithinWindow(createdAt: string): boolean;
}

export function createAlertDedupeService(): AlertDedupeService {
  return {
    generateDedupeKey({ sourceEventId, source, eventType }) {
      // Use sourceEventId when available for precise dedup
      if (sourceEventId) {
        return `${source}-${sourceEventId}-${eventType}`;
      }
      // Fall back to source + event type (less precise but still useful)
      return `${source}-${eventType}-${Date.now()}`;
    },

    isWithinWindow(createdAt) {
      const created = new Date(createdAt).getTime();
      const now = Date.now();
      return now - created < DEDUPE_WINDOW_MS;
    },
  };
}
