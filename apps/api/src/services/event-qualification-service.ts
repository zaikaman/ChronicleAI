// Event qualification service: evaluates monitored events against configured thresholds

import { EVENT_THRESHOLDS, LIQUIDATION_CLUSTER } from "@chronicleai/config";
import type { EventType } from "@chronicleai/schemas";

export interface QualificationResult {
  qualified: boolean;
  score: number;
  reason: string;
}

export interface EventQualificationService {
  qualify(event: {
    eventType: EventType;
    magnitude?: { value: number; unit: string } | null;
    chainId: number;
    /** liquidation_cluster: number of liquidations in the window */
    clusterCount?: number;
  }): QualificationResult;
}

export function createEventQualificationService(): EventQualificationService {
  return {
    qualify(event) {
      const thresholds = EVENT_THRESHOLDS[event.eventType as keyof typeof EVENT_THRESHOLDS];
      if (!thresholds) {
        return {
          qualified: false,
          score: 0,
          reason: `Unsupported event type: ${event.eventType}`,
        };
      }

      // Contract creates are extremely common; do not auto-publish public alerts.
      // Events are still ingested and can appear in digests/activity when needed.
      if (event.eventType === "contract_deployment") {
        return {
          qualified: false,
          score: 0,
          reason:
            "Contract deployments are not auto-qualified (noise control); raise EVENT_THRESHOLDS.contract_deployment to re-enable",
        };
      }

      // If no magnitude, the event cannot be quantified
      if (!event.magnitude || event.magnitude.value === undefined) {
        return {
          qualified: false,
          score: 0,
          reason: "Missing magnitude data for qualification",
        };
      }

      const magnitude = event.magnitude.value;
      const minMagnitude = thresholds.minMagnitude;

      // Liquidation cluster: dual gate — count ≥ N and notional ≥ floor
      if (event.eventType === "liquidation_cluster") {
        const minCount = LIQUIDATION_CLUSTER.minCount;
        const count = event.clusterCount ?? 0;
        if (count < minCount) {
          return {
            qualified: false,
            score: 0,
            reason: `Liquidation cluster count ${count} below minimum ${minCount}`,
          };
        }
        if (magnitude < minMagnitude) {
          return {
            qualified: false,
            score: 0,
            reason: `Liquidation cluster notional ${magnitude} USD below threshold of ${minMagnitude} USD`,
          };
        }
        const ratio = magnitude / minMagnitude;
        const score = Math.min(1.0, 0.5 + ratio * 0.25 + Math.min(count, 10) * 0.02);
        return {
          qualified: true,
          score,
          reason: `Liquidation cluster: ${count} events, ${magnitude} USD (min ${minCount} / $${minMagnitude})`,
        };
      }

      if (magnitude >= minMagnitude) {
        // Calculate a normalized score (0.5 to 1.0) based on how much the magnitude exceeds the threshold
        const ratio = magnitude / minMagnitude;
        const score = Math.min(1.0, 0.5 + ratio * 0.25);

        return {
          qualified: true,
          score,
          reason: `Event magnitude ${magnitude} ${thresholds.unit} meets threshold of ${minMagnitude} ${thresholds.unit}`,
        };
      }

      return {
        qualified: false,
        score: 0,
        reason: `Event magnitude ${magnitude} ${thresholds.unit} below threshold of ${minMagnitude} ${thresholds.unit}`,
      };
    },
  };
}
