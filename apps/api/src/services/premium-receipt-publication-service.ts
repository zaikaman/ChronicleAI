/**
 * Soft-fail on-chain publishPremiumReceipt after a premium payment settles.
 *
 * Settlement always succeeds even if the registry write fails; failures are
 * logged as execution_logs with action_type premium_receipt / failed.
 */

import type {
  ExecutionLogRepository,
  PaymentRecordRepository,
  PaymentRecordRow,
  PremiumIntelligenceItemRow,
} from "@chronicleai/db";
import {
  hashPremiumReceiptContent,
  hashPremiumSettlementSource,
} from "./content-hash.ts";
import { buildPremiumReceiptContentUri } from "./content-uri.ts";
import type { ChronicleRegistryService } from "./chronicle-registry-service.ts";
import { softAppendExecutionLog } from "./keeperhub-execution-log.ts";

export interface PremiumReceiptPublishResult {
  attempted: boolean;
  success: boolean;
  contentUri?: string;
  contentHash?: string;
  sourceEventHash?: string;
  registryTxHash?: string;
  keeperHubRunId?: string;
  explorerUrl?: string;
  errorMessage?: string;
}

export interface PremiumReceiptPublicationService {
  /**
   * Publish on-chain receipt for a settled premium access payment.
   * Skips sponsored_monitor items (they use createSponsoredWatch instead).
   */
  publishForSettlement(params: {
    payment: PaymentRecordRow;
    premiumItem: PremiumIntelligenceItemRow | null;
  }): Promise<PremiumReceiptPublishResult>;
}

export function createPremiumReceiptPublicationService(deps: {
  paymentRecordRepo: PaymentRecordRepository;
  execLogRepo: ExecutionLogRepository;
  registry: ChronicleRegistryService | null;
  frontendOrigin: string | null | undefined;
}): PremiumReceiptPublicationService {
  const { paymentRecordRepo, execLogRepo, registry, frontendOrigin } = deps;

  return {
    async publishForSettlement({ payment, premiumItem }) {
      // Sponsored watches have their own dual-tx trail (create + report).
      if (premiumItem?.content_type === "sponsored_monitor") {
        return {
          attempted: false,
          success: false,
          errorMessage: "skipped_sponsored_monitor",
        };
      }

      if (!registry) {
        await softAppendExecutionLog(execLogRepo, {
          action_type: "premium_receipt",
          entity_type: "payment_record",
          entity_id: payment.id,
          status: "failed",
          message: "Premium receipt skipped: registry not configured",
          details: {
            method: "publishPremiumReceipt",
            reason: "registry_not_configured",
            premium_item_id: payment.premium_item_id,
          },
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        });
        return {
          attempted: false,
          success: false,
          errorMessage: "registry_not_configured",
        };
      }

      if (!frontendOrigin?.trim()) {
        await softAppendExecutionLog(execLogRepo, {
          action_type: "premium_receipt",
          entity_type: "payment_record",
          entity_id: payment.id,
          status: "failed",
          message: "Premium receipt skipped: FRONTEND_ORIGIN not configured",
          details: {
            method: "publishPremiumReceipt",
            reason: "frontend_origin_missing",
            premium_item_id: payment.premium_item_id,
          },
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        });
        return {
          attempted: false,
          success: false,
          errorMessage: "frontend_origin_missing",
        };
      }

      let contentUri: string;
      try {
        contentUri = buildPremiumReceiptContentUri(frontendOrigin, payment.premium_item_id);
      } catch (error) {
        const message = error instanceof Error ? error.message : "invalid_content_uri";
        await softAppendExecutionLog(execLogRepo, {
          action_type: "premium_receipt",
          entity_type: "payment_record",
          entity_id: payment.id,
          status: "failed",
          message: `Premium receipt contentUri invalid: ${message}`,
          details: {
            method: "publishPremiumReceipt",
            reason: "invalid_content_uri",
            error_message: message,
            premium_item_id: payment.premium_item_id,
          },
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        });
        return {
          attempted: false,
          success: false,
          errorMessage: message,
        };
      }

      const settlementRef =
        payment.settlement_reference ?? payment.challenge_reference ?? payment.id;
      const contentSnapshot = [
        premiumItem?.title ?? "",
        premiumItem?.summary_public ?? "",
        typeof premiumItem?.content_private === "string"
          ? premiumItem.content_private
          : premiumItem?.content_private
            ? JSON.stringify(premiumItem.content_private)
            : "",
      ]
        .filter((s) => s.length > 0)
        .join("\n");

      const contentHash = hashPremiumReceiptContent({
        paymentRecordId: payment.id,
        premiumItemId: payment.premium_item_id,
        contentUri,
        contentSnapshot: contentSnapshot || undefined,
        payerReference: payment.payer_reference,
        settlementReference: settlementRef,
      });
      const sourceEventHash = hashPremiumSettlementSource(settlementRef);

      const startedAt = new Date().toISOString();
      await softAppendExecutionLog(execLogRepo, {
        action_type: "premium_receipt",
        entity_type: "payment_record",
        entity_id: payment.id,
        status: "started",
        message: "Publishing premium receipt on-chain",
        details: {
          method: "publishPremiumReceipt",
          premium_item_id: payment.premium_item_id,
          content_uri: contentUri,
          content_hash: contentHash,
          source_event_hash: sourceEventHash,
        },
        started_at: startedAt,
        completed_at: null,
      });

      const published = await registry.publishPremiumReceipt(
        contentHash,
        sourceEventHash,
        contentUri,
      );

      if (!published.success) {
        const errorMessage = published.errorMessage ?? "publishPremiumReceipt failed";
        await softAppendExecutionLog(execLogRepo, {
          action_type: "premium_receipt",
          entity_type: "payment_record",
          entity_id: payment.id,
          status: "failed",
          message: `Premium receipt registry write failed: ${errorMessage}`,
          details: {
            method: "publishPremiumReceipt",
            premium_item_id: payment.premium_item_id,
            content_uri: contentUri,
            content_hash: contentHash,
            source_event_hash: sourceEventHash,
            error_message: errorMessage,
            keeper_hub_run_id: published.keeperHubRunId ?? null,
          },
          started_at: startedAt,
          completed_at: new Date().toISOString(),
        });
        const failResult: PremiumReceiptPublishResult = {
          attempted: true,
          success: false,
          contentUri,
          contentHash,
          sourceEventHash,
          errorMessage,
        };
        if (published.keeperHubRunId) {
          failResult.keeperHubRunId = published.keeperHubRunId;
        }
        return failResult;
      }

      // Soft-fail DB update: settlement already committed.
      const proofWrite = await paymentRecordRepo.markRegistryProof(payment.id, {
        registry_tx_hash: published.txHash ?? null,
        keeper_hub_run_id: published.keeperHubRunId ?? null,
        explorer_url: published.explorerUrl ?? null,
        content_uri: contentUri,
      });
      if (!proofWrite.ok) {
        console.error(
          `[premium-receipt] markRegistryProof failed payment=${payment.id}: ${proofWrite.error.message}`,
        );
      }

      await softAppendExecutionLog(execLogRepo, {
        action_type: "premium_receipt",
        entity_type: "payment_record",
        entity_id: payment.id,
        status: "succeeded",
        message: "Premium receipt published on-chain",
        details: {
          method: "publishPremiumReceipt",
          premium_item_id: payment.premium_item_id,
          content_uri: contentUri,
          content_hash: contentHash,
          source_event_hash: sourceEventHash,
          tx_hash: published.txHash ?? null,
          registry_tx_hash: published.txHash ?? null,
          keeper_hub_run_id: published.keeperHubRunId ?? null,
          explorer_url: published.explorerUrl ?? null,
          gas_used: published.gasUsed ?? null,
        },
        started_at: startedAt,
        completed_at: new Date().toISOString(),
      });

      const okResult: PremiumReceiptPublishResult = {
        attempted: true,
        success: true,
        contentUri,
        contentHash,
        sourceEventHash,
      };
      if (published.txHash) okResult.registryTxHash = published.txHash;
      if (published.keeperHubRunId) okResult.keeperHubRunId = published.keeperHubRunId;
      if (published.explorerUrl) okResult.explorerUrl = published.explorerUrl;
      return okResult;
    },
  };
}
