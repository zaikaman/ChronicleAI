// Operator Audit Service
// Aggregates dashboard data under one typed response

import type { OperatorAuditResponse, TreasuryStatus } from "@chronicleai/schemas";
import type { OperatorAuditRepository } from "@chronicleai/db";

export interface OperatorAuditService {
  getAudit(): Promise<{
    success: boolean;
    data?: OperatorAuditResponse;
    error?: string;
  }>;
}

export function createOperatorAuditService(
  auditRepo: OperatorAuditRepository,
): OperatorAuditService {
  return {
    async getAudit() {
      try {
        const auditResult = await auditRepo.getAuditData(10);

        if (!auditResult.ok) {
          return {
            success: false,
            error: `Failed to fetch audit data: ${auditResult.error.message}`,
          };
        }

        const data = auditResult.value;

        // Map treasury snapshots to a simplified treasury status
        const latestSnapshot = data.treasurySnapshots[0];
        const treasury = {
          availableBalance: latestSnapshot?.available_balance ?? 0,
          safetyBuffer: latestSnapshot?.safety_buffer ?? 0,
          status: (latestSnapshot?.status ?? "unknown") as TreasuryStatus,
        };

        // Map alerts to response format
        const alerts = data.recentAlerts.map((a) => ({
          id: a.id,
          title: a.title,
          summary: a.summary,
          sourceReferences: a.source_references,
          deliveryStatus: a.delivery_status as "draft" | "queued" | "published" | "partial_failure" | "failed",
          publishedAt: a.published_at ?? a.created_at,
          confidence: a.confidence as "high" | "medium" | "low" | undefined,
          generationProvider: a.generation_provider ?? undefined,
        }));

        // Map digests to response format
        const digests = data.recentDigests.map((d) => ({
          id: d.id,
          reportDate: d.report_date,
          title: d.title,
          summary: d.summary,
          highlights: d.highlights,
          analysis: d.analysis ?? undefined,
          publicationStatus: d.publication_status,
          publishedAt: d.published_at ?? undefined,
          registryTxHash: d.registry_tx_hash ?? undefined,
          sourceEventRoot: d.source_event_root ?? undefined,
          contentUri: d.content_uri ?? undefined,
        }));

        // Map payments to response format
        const payments = data.recentPayments.map((p) => ({
          id: p.id,
          premiumItemId: p.premium_item_id,
          paymentRoute: p.payment_route as "x402" | "mpp",
          status: p.status,
          settlementReference: p.settlement_reference ?? undefined,
        }));

        // Map execution logs
        const executionLogs = data.recentLogs.map((l) => ({
          id: l.id,
          actionType: l.action_type,
          entityType: l.entity_type,
          entityId: l.entity_id,
          status: l.status,
          message: l.message,
          details: l.details,
          createdAt: l.created_at,
        }));

        return {
          success: true,
          data: {
            alerts,
            digests,
            payments,
            treasury,
            executionLogs,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error building audit",
        };
      }
    },
  };
}
