// Alert publication service: local public feed + KeeperHub registry write
// + community channel fan-out (Discord / Telegram) with registry tx hash.
//
// IDEA Loop 1: after publishAlert registry write, broadcast alert summaries
// to Discord and Telegram including the KeeperHub execution transaction hash.

import type { PublicAlertRepository } from "@chronicleai/db";
import type { AlertDeliveryStatus } from "@chronicleai/schemas";
import type { ChronicleRegistryService } from "./chronicle-registry-service.ts";
import { buildAlertContentUri } from "./content-uri.ts";
import type {
  ChannelDeliveryResult,
  NotificationService,
} from "./notification-service.ts";

export interface PublicationResult {
  success: boolean;
  deliveryStatus: AlertDeliveryStatus;
  publishedAt?: string | undefined;
  message: string;
  registryTxHash?: string | undefined;
  keeperHubRunId?: string | undefined;
  explorerUrl?: string | undefined;
  contentUri?: string | undefined;
  /** Community channel delivery outcome (Discord / Telegram / log). */
  communityBroadcast?: ChannelDeliveryResult | undefined;
}

export interface AlertPublicationService {
  /**
   * Publish an alert: mark public, anchor on-chain via KeeperHub registry write,
   * then fan out to Discord/Telegram with the registry transaction hash.
   */
  publishAlert(alertId: string, sourceEventHash?: string): Promise<PublicationResult>;
}

export function createAlertPublicationService(
  alertRepo: PublicAlertRepository,
  registryService?: ChronicleRegistryService | null,
  frontendOrigin?: string,
  notificationService?: NotificationService | null,
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
              ...(keeperHubRunId ? { keeperHubRunId } : {}),
              ...(explorerUrl ? { explorerUrl } : {}),
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

      // IDEA Loop 1 step 5: broadcast to Discord + Telegram with registry tx hash.
      // Soft-fail: community channel outages must not undo a successful publish.
      let communityBroadcast: ChannelDeliveryResult | undefined;
      if (notificationService) {
        // Prefer findById so event_type from the monitored_events join is available.
        const fullAlertResult = await alertRepo.findById(alertId);
        const alert =
          fullAlertResult && fullAlertResult.ok ? fullAlertResult.value : result.value;
        try {
          communityBroadcast = await notificationService.sendAlertBroadcast({
            alertId,
            title: alert.title,
            summary: alert.summary,
            eventType: alert.event_type ?? null,
            registryTxHash,
            explorerUrl,
            contentUri,
            publishedAt: now,
          });
        } catch {
          communityBroadcast = {
            delivered: false,
            destinations: [],
            failures: ["community_broadcast_threw"],
          };
        }
      }

      const viaKeeperHub = Boolean(keeperHubRunId || registryTxHash);
      const channels = communityBroadcast?.destinations.filter(
        (d) => d === "discord" || d === "telegram",
      );
      const channelSuffix =
        channels && channels.length > 0 ? `; broadcast to ${channels.join(", ")}` : "";

      return {
        success: true,
        deliveryStatus: "published",
        publishedAt: now,
        message: viaKeeperHub
          ? `Alert published and anchored via KeeperHub${keeperHubRunId ? ` (run ${keeperHubRunId})` : ""}${channelSuffix}`
          : `Alert published to public feed${channelSuffix}`,
        registryTxHash,
        keeperHubRunId,
        explorerUrl,
        contentUri,
        communityBroadcast,
      };
    },
  };
}
