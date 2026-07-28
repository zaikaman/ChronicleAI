// Alert publication service: local public feed + KeeperHub registry write
// + Telegram community channel fan-out with registry tx hash.
//
// IDEA Loop 1: after publishAlert registry write, broadcast alert summaries
// to Telegram including the KeeperHub execution transaction hash.
//
// FR-026 / IDEA Loop 3: registry writes are treasury-gated — suspended when
// the agent treasury balance is below the safety buffer; local publish still
// proceeds and a public low-balance warning is emitted.
//
// IDEA demo packaging: content hash, gas used, registry tx, KeeperHub status.
//
// Note: monitored source chain (e.g. Ethereum Mainnet) may differ from the
// KeeperHub registry chain (Ethereum Sepolia). Telegram labels both clearly.

import { chainLabel, txExplorerUrl } from "@chronicleai/config";
import type { ExecutionLogRepository, PublicAlertRepository } from "@chronicleai/db";
import type { AlertDeliveryStatus } from "@chronicleai/schemas";
import type { ChronicleRegistryService } from "./chronicle-registry-service.ts";
import { hashAlertContent } from "./content-hash.ts";
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
  contentHash?: string | undefined;
  gasUsed?: string | undefined;
  gasUsedWei?: string | undefined;
  /** True when on-chain registry write was skipped due to treasury gate. */
  registrySuspended?: boolean | undefined;
  /** Community channel delivery outcome (Telegram / log). */
  communityBroadcast?: ChannelDeliveryResult | undefined;
}

export interface AlertPublicationService {
  /**
   * Publish an alert: mark public, anchor on-chain via KeeperHub registry write
   * (when treasury allows), then fan out to Telegram with the registry
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

      // Load alert early so we can hash real title/summary for on-chain contentHash.
      const existingResult = await alertRepo.findById(alertId);
      if (!existingResult.ok) {
        return {
          success: false,
          deliveryStatus: "failed",
          message: `Failed to load alert for publication: ${existingResult.error.message}`,
        };
      }
      const existing = existingResult.value;

      let registryTxHash: string | undefined;
      let keeperHubRunId: string | undefined;
      let explorerUrl: string | undefined;
      let contentUri: string | undefined;
      let contentHash: string | undefined;
      let gasUsed: string | undefined;
      let gasUsedWei: string | undefined;
      let registrySuspended = false;

      if (frontendOrigin) {
        contentUri = buildAlertContentUri(frontendOrigin, alertId);
      }

      contentHash = hashAlertContent({
        alertId,
        title: existing.title,
        summary: existing.summary,
        contentUri,
      });

      const resolvedSourceEventHash = sourceEventHash ?? alertId;

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
                source_event_hash: resolvedSourceEventHash,
                content_hash: contentHash,
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
            sourceEventHash: resolvedSourceEventHash,
            contentHash,
          });
        } else {
          const registryStartedAt = new Date().toISOString();
          const registryResult = await registryService.publishAlert(
            contentHash,
            resolvedSourceEventHash,
            contentUri,
          );
          if (registryResult.success && registryResult.txHash) {
            registryTxHash = registryResult.txHash;
            keeperHubRunId = registryResult.keeperHubRunId;
            explorerUrl = registryResult.explorerUrl;
            gasUsed = registryResult.gasUsed;
            gasUsedWei = registryResult.gasUsedWei;
            // Prefer normalized bytes32 from registry service when present.
            contentHash = registryResult.contentHash ?? contentHash;
            await alertRepo.updateRegistryMetadata(alertId, {
              registryTxHash,
              sourceEventHash: resolvedSourceEventHash,
              contentUri,
              contentHash,
              ...(gasUsed ? { gasUsed } : {}),
              ...(gasUsedWei ? { gasUsedWei } : {}),
              ...(keeperHubRunId ? { keeperHubRunId } : {}),
              ...(explorerUrl ? { explorerUrl } : {}),
            });
            if (execLogRepo) {
              const completedAt = new Date().toISOString();
              try {
                const logResult = await execLogRepo.append({
                  action_type: "registry_write",
                  entity_type: "public_alert",
                  entity_id: alertId,
                  status: "succeeded",
                  message: `Alert registry write succeeded${keeperHubRunId ? ` (run ${keeperHubRunId})` : ""}`,
                  details: {
                    method: "publishAlert",
                    reason: "registry_write_ok",
                    tx_hash: registryTxHash,
                    keeper_hub_run_id: keeperHubRunId ?? null,
                    explorer_url: explorerUrl ?? null,
                    gas_used: gasUsed ?? null,
                    gas_used_wei: gasUsedWei ?? null,
                    source_event_hash: resolvedSourceEventHash,
                    content_hash: contentHash,
                    content_uri: contentUri,
                  },
                  started_at: registryStartedAt,
                  completed_at: completedAt,
                });
                if (!logResult.ok) {
                  console.error(
                    "[alert-publication] registry_write success log failed:",
                    logResult.error.message,
                  );
                }
              } catch (error) {
                console.error(
                  "[alert-publication] registry_write success log threw:",
                  error instanceof Error ? error.message : error,
                );
              }
            }
          } else {
            // Soft-fail local publish still proceeds so readers get the alert;
            // execution log records the registry failure for Activity visibility.
            const failMessage =
              registryResult.errorMessage ??
              (registryResult.success
                ? "Registry write reported success without txHash"
                : "Registry write failed");
            await alertRepo.updateRegistryMetadata(alertId, {
              sourceEventHash: resolvedSourceEventHash,
              contentUri,
              contentHash,
            });
            if (execLogRepo) {
              const completedAt = new Date().toISOString();
              try {
                const logResult = await execLogRepo.append({
                  action_type: "registry_write",
                  entity_type: "public_alert",
                  entity_id: alertId,
                  status: "failed",
                  message: failMessage,
                  details: {
                    method: "publishAlert",
                    reason: "registry_write_failed",
                    error_message: failMessage,
                    keeper_hub_run_id: registryResult.keeperHubRunId ?? null,
                    source_event_hash: resolvedSourceEventHash,
                    content_hash: contentHash,
                    content_uri: contentUri,
                  },
                  started_at: registryStartedAt,
                  completed_at: completedAt,
                });
                if (!logResult.ok) {
                  console.error(
                    "[alert-publication] registry_write failure log failed:",
                    logResult.error.message,
                  );
                }
              } catch (error) {
                console.error(
                  "[alert-publication] registry_write failure log threw:",
                  error instanceof Error ? error.message : error,
                );
              }
            }
          }
        }
      } else {
        // No registry service, or treasury-gated suspension: local metadata only.
        if (contentUri || sourceEventHash || contentHash || registrySuspended) {
          await alertRepo.updateRegistryMetadata(alertId, {
            sourceEventHash: resolvedSourceEventHash,
            contentHash,
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

      // IDEA Loop 1 step 5: broadcast to Telegram with registry tx hash.
      // Soft-fail: community channel outages must not undo a successful publish.
      let communityBroadcast: ChannelDeliveryResult | undefined;
      if (notificationService) {
        // Prefer findById so event_type from the monitored_events join is available.
        const fullAlertResult = await alertRepo.findById(alertId);
        const alert =
          fullAlertResult && fullAlertResult.ok ? fullAlertResult.value : result.value;
        try {
          const sourceChainId =
            typeof alert.chain_id === "number" ? alert.chain_id : null;
          const sourceTxHash =
            typeof alert.transaction_hash === "string" ? alert.transaction_hash : null;
          const sourceExplorerUrl =
            sourceChainId != null && sourceTxHash
              ? txExplorerUrl(sourceChainId, sourceTxHash)
              : null;

          communityBroadcast = await notificationService.sendAlertBroadcast({
            alertId,
            title: alert.title,
            summary: alert.summary,
            eventType: alert.event_type ?? null,
            sourceChainLabel: sourceChainId != null ? chainLabel(sourceChainId) : null,
            sourceExplorerUrl,
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
        (d) => d === "telegram",
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
        contentHash,
        gasUsed,
        gasUsedWei,
        registrySuspended: registrySuspended || undefined,
        communityBroadcast,
      };
    },
  };
}
