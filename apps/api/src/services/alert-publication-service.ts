// Alert publication service: publishes alerts to local public feed

import type { PublicAlertRepository } from "@chronicleai/db";
import type { AlertDeliveryStatus } from "@chronicleai/schemas";

export interface PublicationResult {
  success: boolean;
  deliveryStatus: AlertDeliveryStatus;
  publishedAt?: string;
  message: string;
}

export interface AlertPublicationService {
  /**
   * Publish an alert. For Phase 3, publication means local persisted public visibility.
   */
  publishAlert(alertId: string): Promise<PublicationResult>;
}

export function createAlertPublicationService(
  alertRepo: PublicAlertRepository,
): AlertPublicationService {
  return {
    async publishAlert(alertId) {
      const now = new Date().toISOString();

      const result = await alertRepo.updateDeliveryStatus(alertId, "published", now);

      if (!result.ok) {
        return {
          success: false,
          deliveryStatus: "failed",
          message: `Failed to publish alert: ${result.error.message}`,
        };
      }

      return {
        success: true,
        deliveryStatus: "published",
        publishedAt: now,
        message: "Alert published to public feed",
      };
    },
  };
}
