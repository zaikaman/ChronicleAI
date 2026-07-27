// Digest publication service: orchestrates Chronicle Registry -> Webflow -> SMTP dispatch

import type { DailyDigestRepository } from "@chronicleai/db";
import type {
  ChronicleRegistryService,
  RegistryPublishResult,
} from "./chronicle-registry-service.ts";
import type { SmtpEmailService, SmtpSendResult } from "./smtp-email-service.ts";
import type {
  WebflowPublishResult,
  WebflowPublishingService,
} from "./webflow-publishing-service.ts";

export interface DigestPublicationResult {
  success: boolean;
  publishedAt: string;
  registryTxHash: string | undefined;
  contentUri: string | undefined;
  smtpResult: SmtpSendResult | undefined;
  errorMessage: string | undefined;
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
  webflowService: WebflowPublishingService,
  smtpService: SmtpEmailService,
): DigestPublicationService {
  return {
    async publishDigest(digest) {
      const publishedAt = new Date().toISOString();
      let registryTxHash: string | undefined;
      let contentUri: string | undefined;
      let smtpResult: SmtpSendResult | undefined;
      let webflowResult: WebflowPublishResult | undefined;
      const failures: string[] = [];

      // Step 1: Chronicle Registry on-chain publish
      const registryResult: RegistryPublishResult = await registryService.publishDigest(
        digest.id,
        digest.sourceEventRoot ?? digest.id,
      );
      if (registryResult.success && registryResult.txHash) {
        registryTxHash = registryResult.txHash;
        await digestRepo.updateRegistryMetadata(digest.id, { registryTxHash });
      } else {
        failures.push(`Registry: ${registryResult.errorMessage ?? "unknown error"}`);
      }

      // Step 2: Webflow publish
      webflowResult = await webflowService.publishDigestArticle({
        title: digest.title,
        summary: digest.summary,
        highlights: digest.highlights,
        analysis: digest.analysis ?? undefined,
        reportDate: digest.reportDate,
        registryTxHash,
      });
      if (webflowResult.success && webflowResult.contentUri) {
        contentUri = webflowResult.contentUri;
        await digestRepo.updateRegistryMetadata(digest.id, { contentUri });
      } else {
        failures.push(`Webflow: ${webflowResult.errorMessage ?? "unknown error"}`);
      }

      // Step 3: SMTP email broadcast
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

      const publicationStatus =
        failures.length === 0 ? "published" : failures.length < 3 ? "partial_failure" : "failed";

      await digestRepo.updatePublicationStatus(digest.id, publicationStatus, publishedAt);

      return {
        success: publicationStatus !== "failed",
        publishedAt,
        registryTxHash: registryTxHash ?? undefined,
        contentUri: contentUri ?? undefined,
        smtpResult: smtpResult ?? undefined,
        errorMessage: failures.length > 0 ? failures.join("; ") : undefined,
        publicationStatus,
      };
    },
  };
}
