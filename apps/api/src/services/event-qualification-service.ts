// Event qualification service: evaluates monitored events against configured thresholds

import { EVENT_THRESHOLDS } from "@chronicleai/config";
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
  }): QualificationResult;
}

export function createEventQualificationService(): EventQualificationService {
  return {
    qualify(event) {
      const thresholds = EVENT_THRESHOLDS[event.eventType];
      if (!thresholds) {
        return {
          qualified: false,
          score: 0,
          reason: `Unsupported event type: ${event.eventType}`,
        };
      }

      // contract_deployment qualifies by default (any deployment is notable)
      if (event.eventType === "contract_deployment") {
        return {
          qualified: true,
          score: 0.5,
          reason: "Contract deployment detected",
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
