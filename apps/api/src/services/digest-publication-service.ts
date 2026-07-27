// Digest publication service: orchestrates Chronicle Registry -> SMTP dispatch with self-hosted content

import type { DailyDigestRepository } from "@chronicleai/db";
import type {
  ChronicleRegistryService,
  RegistryPublishResult,
} from "./chronicle-registry-service.ts";
import type { SmtpEmailService, SmtpSendResult } from "./smtp-email-service.ts";

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
  frontendOrigin: string,
  smtpService: SmtpEmailService,
): DigestPublicationService {
  return {
    async publishDigest(digest) {
      const publishedAt = new Date().toISOString();
      let registryTxHash: string | undefined;
      let smtpResult: SmtpSendResult | undefined;
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

      // Step 2: Self-hosted content URI — points to our own app
      const origin = frontendOrigin.replace(/\/+$/, "");
      const contentUri = `${origin}/digests/latest`;
      await digestRepo.updateRegistryMetadata(digest.id, { contentUri });

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
        failures.length === 0 ? "published" : failures.length < 2 ? "partial_failure" : "failed";

      await digestRepo.updatePublicationStatus(digest.id, publicationStatus, publishedAt);

      return {
        success: publicationStatus !== "failed",
        publishedAt,
        registryTxHash: registryTxHash ?? undefined,
        contentUri,
        smtpResult: smtpResult ?? undefined,
        errorMessage: failures.length > 0 ? failures.join("; ") : undefined,
        publicationStatus,
      };
    },
  };
}
