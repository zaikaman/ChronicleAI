// Digest publication service: orchestrates Chronicle Registry -> SMTP dispatch
// + community channel bulletins (Discord / Telegram) with self-hosted content

import type { DailyDigestRepository } from "@chronicleai/db";
import type {
  ChronicleRegistryService,
  RegistryPublishResult,
} from "./chronicle-registry-service.ts";
import { buildDigestContentUri } from "./content-uri.ts";
import type {
  ChannelDeliveryResult,
  NotificationService,
} from "./notification-service.ts";
import type { SmtpEmailService, SmtpSendResult } from "./smtp-email-service.ts";

export interface DigestPublicationResult {
  success: boolean;
  publishedAt: string;
  registryTxHash?: string | undefined;
  keeperHubRunId?: string | undefined;
  explorerUrl?: string | undefined;
  contentUri?: string | undefined;
  smtpResult?: SmtpSendResult | undefined;
  communityBroadcast?: ChannelDeliveryResult | undefined;
  errorMessage?: string | undefined;
  publicationStatus: "published" | "partial_failure" | "failed";
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
): DigestPublicationService {
  return {
    async publishDigest(digest) {
      const publishedAt = new Date().toISOString();
      let registryTxHash: string | undefined;
      let smtpResult: SmtpSendResult | undefined;
      let communityBroadcast: ChannelDeliveryResult | undefined;
      const failures: string[] = [];

      let keeperHubRunId: string | undefined;
      let explorerUrl: string | undefined;

      // Self-hosted HTTPS content URI — stable per-digest public page (Vercel SPA).
      const contentUri = buildDigestContentUri(frontendOrigin, digest.id);

      // Step 1: Chronicle Registry on-chain publish with the same resolvable URI
      const registryResult: RegistryPublishResult = await registryService.publishDigest(
        digest.id,
        digest.sourceEventRoot ?? digest.id,
        contentUri,
      );
      if (registryResult.success && registryResult.txHash) {
        registryTxHash = registryResult.txHash;
        keeperHubRunId = registryResult.keeperHubRunId;
        explorerUrl = registryResult.explorerUrl;
        await digestRepo.updateRegistryMetadata(digest.id, {
          registryTxHash,
          contentUri,
          ...(keeperHubRunId ? { keeperHubRunId } : {}),
          ...(explorerUrl ? { explorerUrl } : {}),
        });
      } else {
        failures.push(`Registry: ${registryResult.errorMessage ?? "unknown error"}`);
        await digestRepo.updateRegistryMetadata(digest.id, { contentUri });
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

      // Step 3: Discord / Telegram community bulletins with registry tx hash
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
      // nothing reached readers (registry always attempted; SMTP always attempted).
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
        smtpResult: smtpResult ?? undefined,
        communityBroadcast,
        errorMessage: failures.length > 0 ? failures.join("; ") : undefined,
        publicationStatus,
      };
    },
  };
}
