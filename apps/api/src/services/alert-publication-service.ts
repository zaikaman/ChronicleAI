// Alert publication service: local public feed + KeeperHub registry write
// + community channel fan-out (Discord / Telegram) with registry tx hash.
//
// IDEA Loop 1: after publishAlert registry write, broadcast alert summaries
// to Discord and Telegram including the KeeperHub execution transaction hash.
//
// FR-026 / IDEA Loop 3: registry writes are treasury-gated — suspended when
// the Para wallet balance is below the safety buffer; local publish still
// proceeds and a public low-balance warning is emitted.

import type { ExecutionLogRepository, PublicAlertRepository } from "@chronicleai/db";
import type { AlertDeliveryStatus } from "@chronicleai/schemas";
import type { ChronicleRegistryService } from "./chronicle-registry-service.ts";
import { buildAlertContentUri } from "./content-uri.ts";
import type {
  ChannelDeliveryResult,
  NotificationService,
} from "./notification-service.ts";
import type { TreasuryRegistryGate } from "./treasury-registry-gate.ts";

export interface PublicationResult {
  success: boolean;
  deliveryStatus: AlertDeliveryStatus;
  publishedAt?: string | undefined;
  message: string;
  registryTxHash?: string | undefined;
  keeperHubRunId?: string | undefined;
  explorerUrl?: string | undefined;
  contentUri?: string | undefined;
  /** True when on-chain registry write was skipped due to treasury gate. */
  registrySuspended?: boolean | undefined;
  /** Community channel delivery outcome (Discord / Telegram / log). */
  communityBroadcast?: ChannelDeliveryResult | undefined;
}

export interface AlertPublicationService {
  /**
   * Publish an alert: mark public, anchor on-chain via KeeperHub registry write
   * (when treasury allows), then fan out to Discord/Telegram with the registry
   * transaction hash.
   */
  publishAlert(alertId: string, sourceEventHash?: string): Promise<PublicationResult>;
}

export function createAlertPublicationService(
  alertRepo: PublicAlertRepository,
  registryService?: ChronicleRegistryService | null,
  frontendOrigin?: string,
  notificationService?: NotificationService | null,
  treasuryGate?: TreasuryRegistryGate | null,
  execLogRepo?: ExecutionLogRepository | null,
): AlertPublicationService {
  return {
    async publishAlert(alertId, sourceEventHash) {
      const now = new Date().toISOString();

      let registryTxHash: string | undefined;
      let keeperHubRunId: string | undefined;
      let explorerUrl: string | undefined;
      let contentUri: string | undefined;
      let registrySuspended = false;

      if (frontendOrigin) {
        contentUri = buildAlertContentUri(frontendOrigin, alertId);
      }

      // FR-026: consult treasury before any on-chain registry write.
      let allowRegistryWrite = true;
      if (registryService && treasuryGate) {
        const decision = await treasuryGate.evaluate();
        if (!decision.allowRegistryWrite) {
          allowRegistryWrite = false;
          registrySuspended = true;

          if (execLogRepo) {
            await execLogRepo.append({
              action_type: "registry_write",
              entity_type: "public_alert",
              entity_id: alertId,
              status: "failed",
              message: `Registry write suspended: ${decision.reason}`,
              details: {
                reason: "treasury_gate",
                available_balance: decision.availableBalance,
                safety_buffer: decision.safetyBuffer,
                treasury_status: decision.status,
                deficit_percentage: decision.deficitPercentage,
                snapshot_id: decision.snapshotId,
                source_event_hash: sourceEventHash ?? alertId,
                content_uri: contentUri,
              },
              started_at: now,
              completed_at: now,
            });
          }

          // Public low-balance warning on Activity (and configured channels).
          if (
            notificationService &&
            decision.availableBalance !== undefined &&
            decision.safetyBuffer !== undefined
          ) {
            try {
              await notificationService.sendLowBalanceWarning({
                availableBalance: decision.availableBalance,
                safetyBuffer: decision.safetyBuffer,
                deficitPercentage: decision.deficitPercentage ?? 0,
                status: decision.status ?? "warning",
              });
            } catch {
              // Soft-fail: warning delivery must not block local publish.
            }
          }
        }
      }

      if (registryService && allowRegistryWrite) {
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
      } else {
        // No registry service, or treasury-gated suspension: local metadata only.
        if (contentUri || sourceEventHash || registrySuspended) {
          await alertRepo.updateRegistryMetadata(alertId, {
            sourceEventHash: sourceEventHash ?? alertId,
            ...(contentUri ? { contentUri } : {}),
          });
        }
      }

      const result = await alertRepo.updateDeliveryStatus(alertId, "published", now);

      if (!result.ok) {
        return {
          success: false,
          deliveryStatus: "failed",
          message: `Failed to publish alert: ${result.error.message}`,
          registrySuspended: registrySuspended || undefined,
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

      let message: string;
      if (registrySuspended) {
        message = `Alert published to public feed; registry write suspended (treasury below safety buffer)${channelSuffix}`;
      } else if (viaKeeperHub) {
        message = `Alert published and anchored via KeeperHub${keeperHubRunId ? ` (run ${keeperHubRunId})` : ""}${channelSuffix}`;
      } else {
        message = `Alert published to public feed${channelSuffix}`;
      }

      return {
        success: true,
        deliveryStatus: "published",
        publishedAt: now,
        message,
        registryTxHash,
        keeperHubRunId,
        explorerUrl,
        contentUri,
        registrySuspended: registrySuspended || undefined,
        communityBroadcast,
      };
    },
  };
}
