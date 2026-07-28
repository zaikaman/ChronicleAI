// Alert publication service: local public feed + KeeperHub registry write

import type { PublicAlertRepository } from "@chronicleai/db";
import type { AlertDeliveryStatus } from "@chronicleai/schemas";
import type { ChronicleRegistryService } from "./chronicle-registry-service.ts";
import { buildAlertContentUri } from "./content-uri.ts";

export interface PublicationResult {
  success: boolean;
  deliveryStatus: AlertDeliveryStatus;
  publishedAt?: string;
  message: string;
  registryTxHash?: string;
  keeperHubRunId?: string;
  explorerUrl?: string;
  contentUri?: string;
}

export interface AlertPublicationService {
  /**
   * Publish an alert: mark public, then anchor on-chain via KeeperHub registry write.
   */
  publishAlert(alertId: string, sourceEventHash?: string): Promise<PublicationResult>;
}

export function createAlertPublicationService(
  alertRepo: PublicAlertRepository,
  registryService?: ChronicleRegistryService | null,
  frontendOrigin?: string,
): AlertPublicationService {
  return {
    async publishAlert(alertId, sourceEventHash) {
      const now = new Date().toISOString();

      let registryTxHash: string | undefined;
      let keeperHubRunId: string | undefined;
      let explorerUrl: string | undefined;
      let contentUri: string | undefined;

      if (frontendOrigin) {
        contentUri = buildAlertContentUri(frontendOrigin, alertId);
      }

      if (registryService) {
        if (!contentUri) {
          // Soft-fail registry only: still publish to the public feed.
          await alertRepo.updateRegistryMetadata(alertId, {
            sourceEventHash: sourceEventHash ?? alertId,
          });
        } else {
          const registryResult = await registryService.publishAlert(
            alertId,
            sourceEventHash ?? alertId,
            contentUri,
          );
          if (registryResult.success && registryResult.txHash) {
            registryTxHash = registryResult.txHash;
            keeperHubRunId = registryResult.keeperHubRunId;
            explorerUrl = registryResult.explorerUrl;
            await alertRepo.updateRegistryMetadata(alertId, {
              registryTxHash,
              sourceEventHash: sourceEventHash ?? alertId,
              contentUri,
              keeperHubRunId,
              explorerUrl,
            });
          } else {
            // Soft-fail local publish still proceeds so readers get the alert;
            // execution log upstream records the registry failure.
            await alertRepo.updateRegistryMetadata(alertId, {
              sourceEventHash: sourceEventHash ?? alertId,
              contentUri,
            });
          }
        }
      } else if (contentUri) {
        await alertRepo.updateRegistryMetadata(alertId, {
          sourceEventHash: sourceEventHash ?? alertId,
          contentUri,
        });
      }

      const result = await alertRepo.updateDeliveryStatus(alertId, "published", now);

      if (!result.ok) {
        return {
          success: false,
          deliveryStatus: "failed",
          message: `Failed to publish alert: ${result.error.message}`,
        };
      }

      const viaKeeperHub = Boolean(keeperHubRunId || registryTxHash);
      return {
        success: true,
        deliveryStatus: "published",
        publishedAt: now,
        message: viaKeeperHub
          ? `Alert published and anchored via KeeperHub${keeperHubRunId ? ` (run ${keeperHubRunId})` : ""}`
          : "Alert published to public feed",
        registryTxHash,
        keeperHubRunId,
        explorerUrl,
        contentUri,
      };
    },
  };
}
