// Digest publication service: orchestrates Chronicle Registry -> SMTP dispatch
// + Telegram community channel bulletins with self-hosted content
//
// FR-026 / IDEA Loop 3: registry writes are treasury-gated — suspended when
// the agent treasury balance is below the safety buffer; SMTP/community still
// proceed and a public low-balance warning is emitted.

import type { DailyDigestRepository, ExecutionLogRepository } from "@chronicleai/db";
import type {
  ChronicleRegistryService,
  RegistryPublishResult,
} from "./chronicle-registry-service.ts";
import { hashDigestContent } from "./content-hash.ts";
import { buildDigestContentUri } from "./content-uri.ts";
import type {
  ChannelDeliveryResult,
  NotificationService,
} from "./notification-service.ts";
import type { SmtpEmailService, SmtpSendResult } from "./smtp-email-service.ts";
import type { TreasuryRegistryGate } from "./treasury-registry-gate.ts";

export interface DigestPublicationResult {
  success: boolean;
  publishedAt: string;
  registryTxHash?: string | undefined;
  keeperHubRunId?: string | undefined;
  explorerUrl?: string | undefined;
  contentUri?: string | undefined;
  contentHash?: string | undefined;
  gasUsed?: string | undefined;
  gasUsedWei?: string | undefined;
  smtpResult?: SmtpSendResult | undefined;
  communityBroadcast?: ChannelDeliveryResult | undefined;
  errorMessage?: string | undefined;
  publicationStatus: "published" | "partial_failure" | "failed";
  /** True when on-chain registry write was skipped due to treasury gate. */
  registrySuspended?: boolean | undefined;
}

export interface DigestPublicationService {
  /** Publish a digest through all channels. */
  publishDigest(digest: {
    id: string;
    title: string;
    summary: string;
    highlights: string[];
    analysis?: string | null;
    reportDate: string;
    sourceEventRoot?: string;
  }): Promise<DigestPublicationResult>;
}

export function createDigestPublicationService(
  digestRepo: DailyDigestRepository,
  registryService: ChronicleRegistryService,
  frontendOrigin: string,
  smtpService: SmtpEmailService,
  notificationService?: NotificationService | null,
  treasuryGate?: TreasuryRegistryGate | null,
  execLogRepo?: ExecutionLogRepository | null,
): DigestPublicationService {
  return {
    async publishDigest(digest) {
      const publishedAt = new Date().toISOString();
      let registryTxHash: string | undefined;
      let smtpResult: SmtpSendResult | undefined;
      let communityBroadcast: ChannelDeliveryResult | undefined;
      const failures: string[] = [];
      let registrySuspended = false;

      let keeperHubRunId: string | undefined;
      let explorerUrl: string | undefined;
      let gasUsed: string | undefined;
      let gasUsedWei: string | undefined;

      // Self-hosted HTTPS content URI — stable per-digest public page (Vercel SPA).
      const contentUri = buildDigestContentUri(frontendOrigin, digest.id);
      let contentHash = hashDigestContent({
        digestId: digest.id,
        title: digest.title,
        summary: digest.summary,
        reportDate: digest.reportDate,
        contentUri,
      });

      // FR-026: consult treasury before any on-chain registry write.
      let allowRegistryWrite = true;
      if (treasuryGate) {
        const decision = await treasuryGate.evaluate();
        if (!decision.allowRegistryWrite) {
          allowRegistryWrite = false;
          registrySuspended = true;
          failures.push(`Registry: suspended — ${decision.reason}`);

          if (execLogRepo) {
            await execLogRepo.append({
              action_type: "registry_write",
              entity_type: "daily_digest",
              entity_id: digest.id,
              status: "failed",
              message: `Registry write suspended: ${decision.reason}`,
              details: {
                reason: "treasury_gate",
                available_balance: decision.availableBalance,
                safety_buffer: decision.safetyBuffer,
                treasury_status: decision.status,
                deficit_percentage: decision.deficitPercentage,
                snapshot_id: decision.snapshotId,
                source_event_root: digest.sourceEventRoot ?? digest.id,
                content_hash: contentHash,
                content_uri: contentUri,
              },
              started_at: publishedAt,
              completed_at: publishedAt,
            });
          }

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
              // Soft-fail: warning delivery must not block digest publication.
            }
          }

          await digestRepo.updateRegistryMetadata(digest.id, { contentUri, contentHash });
        }
      }

      // Step 1: Chronicle Registry on-chain publish with the same resolvable URI
      if (allowRegistryWrite) {
        const registryStartedAt = new Date().toISOString();
        const registryResult: RegistryPublishResult = await registryService.publishDigest(
          contentHash,
          digest.sourceEventRoot ?? digest.id,
          contentUri,
        );
        if (registryResult.success && registryResult.txHash) {
          registryTxHash = registryResult.txHash;
          keeperHubRunId = registryResult.keeperHubRunId;
          explorerUrl = registryResult.explorerUrl;
          gasUsed = registryResult.gasUsed;
          gasUsedWei = registryResult.gasUsedWei;
          contentHash = registryResult.contentHash ?? contentHash;
          await digestRepo.updateRegistryMetadata(digest.id, {
            registryTxHash,
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
                entity_type: "daily_digest",
                entity_id: digest.id,
                status: "succeeded",
                message: `Digest registry write succeeded${keeperHubRunId ? ` (run ${keeperHubRunId})` : ""}`,
                details: {
                  method: "publishDigest",
                  reason: "registry_write_ok",
                  tx_hash: registryTxHash,
                  keeper_hub_run_id: keeperHubRunId ?? null,
                  explorer_url: explorerUrl ?? null,
                  gas_used: gasUsed ?? null,
                  gas_used_wei: gasUsedWei ?? null,
                  source_event_root: digest.sourceEventRoot ?? digest.id,
                  content_hash: contentHash,
                  content_uri: contentUri,
                  executedViaKeeperHub: Boolean(keeperHubRunId),
                },
                started_at: registryStartedAt,
                completed_at: completedAt,
              });
              if (!logResult.ok) {
                console.error(
                  "[digest-publication] registry_write success log failed:",
                  logResult.error.message,
                );
              }
            } catch (error) {
              console.error(
                "[digest-publication] registry_write success log threw:",
                error instanceof Error ? error.message : error,
              );
            }
          }
        } else {
          const failMessage =
            registryResult.errorMessage ??
            (registryResult.success
              ? "Registry write reported success without txHash"
              : "Registry write failed");
          failures.push(`Registry: ${failMessage}`);
          await digestRepo.updateRegistryMetadata(digest.id, { contentUri, contentHash });
          if (execLogRepo) {
            const completedAt = new Date().toISOString();
            try {
              const logResult = await execLogRepo.append({
                action_type: "registry_write",
                entity_type: "daily_digest",
                entity_id: digest.id,
                status: "failed",
                message: failMessage,
                details: {
                  method: "publishDigest",
                  reason: "registry_write_failed",
                  error_message: failMessage,
                  keeper_hub_run_id: registryResult.keeperHubRunId ?? null,
                  source_event_root: digest.sourceEventRoot ?? digest.id,
                  content_hash: contentHash,
                  content_uri: contentUri,
                },
                started_at: registryStartedAt,
                completed_at: completedAt,
              });
              if (!logResult.ok) {
                console.error(
                  "[digest-publication] registry_write failure log failed:",
                  logResult.error.message,
                );
              }
            } catch (error) {
              console.error(
                "[digest-publication] registry_write failure log threw:",
                error instanceof Error ? error.message : error,
              );
            }
          }
        }
      }

      // Step 2: SMTP email broadcast (link readers to the public digest page)
      smtpResult = await smtpService.sendDigestBulletin({
        title: digest.title,
        summary: digest.summary,
        highlights: digest.highlights,
        analysis: digest.analysis ?? undefined,
        reportDate: digest.reportDate,
        registryTxHash,
        contentUri,
      });
      if (!smtpResult.success) {
        failures.push(`SMTP: ${smtpResult.errorMessage ?? "unknown error"}`);
      }

      // Step 3: Telegram community bulletins with registry tx hash
      if (notificationService) {
        try {
          communityBroadcast = await notificationService.sendDigestBroadcast({
            digestId: digest.id,
            title: digest.title,
            summary: digest.summary,
            reportDate: digest.reportDate,
            registryTxHash,
            explorerUrl,
            contentUri,
          });
          if (communityBroadcast.failures.length > 0) {
            failures.push(
              `Community: ${communityBroadcast.failures.join(", ")}`,
            );
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : "community broadcast failed";
          failures.push(`Community: ${msg}`);
          communityBroadcast = {
            delivered: false,
            destinations: [],
            failures: [msg],
          };
        }
      }

      // publicationStatus: registry+smtp+community are soft channels; treat as
      // failed only when every configured delivery path failed hard enough that
      // nothing reached readers. Treasury-gated registry skip alone is partial.
      const publicationStatus =
        failures.length === 0
          ? "published"
          : failures.length >= 2
            ? "failed"
            : "partial_failure";

      await digestRepo.updatePublicationStatus(digest.id, publicationStatus, publishedAt);

      return {
        success: publicationStatus !== "failed",
        publishedAt,
        registryTxHash: registryTxHash ?? undefined,
        keeperHubRunId: keeperHubRunId ?? undefined,
        explorerUrl: explorerUrl ?? undefined,
        contentUri,
        contentHash,
        gasUsed: gasUsed ?? undefined,
        gasUsedWei: gasUsedWei ?? undefined,
        smtpResult: smtpResult ?? undefined,
        communityBroadcast,
        errorMessage: failures.length > 0 ? failures.join("; ") : undefined,
        publicationStatus,
        registrySuspended: registrySuspended || undefined,
      };
    },
  };
}
