// Agent Activity Service
// Aggregates public dashboard data under one typed response

import type { AgentActivityRepository } from "@chronicleai/db";
import type { AgentActivityResponse, TreasuryStatus } from "@chronicleai/schemas";

export interface AgentActivityService {
  getActivity(): Promise<{
    success: boolean;
    data?: AgentActivityResponse;
    error?: string;
  }>;
}

export function createAgentActivityService(
  activityRepo: AgentActivityRepository,
): AgentActivityService {
  return {
    async getActivity() {
      try {
        const activityResult = await activityRepo.getActivityData(10);

        if (!activityResult.ok) {
          return {
            success: false,
            error: `Failed to fetch activity data: ${activityResult.error.message}`,
          };
        }

        const data = activityResult.value;

        const latestSnapshot = data.treasurySnapshots[0];
        const treasury = {
          availableBalance: latestSnapshot?.available_balance ?? 0,
          safetyBuffer: latestSnapshot?.safety_buffer ?? 0,
          status: (latestSnapshot?.status ?? "unknown") as TreasuryStatus,
        };

        const alerts = data.recentAlerts.map((a) => {
          const alert: any = {
            id: a.id,
            title: a.title,
            summary: a.summary,
            sourceReferences: a.source_references,
            deliveryStatus: a.delivery_status as
              | "draft"
              | "queued"
              | "published"
              | "partial_failure"
              | "failed",
            publishedAt: a.published_at ?? a.created_at,
          };
          if (a.confidence) {
            alert.confidence = a.confidence;
          }
          if (a.generation_provider) {
            alert.generationProvider = a.generation_provider;
          }
          if (a.registry_tx_hash) alert.registryTxHash = a.registry_tx_hash;
          if (a.keeper_hub_run_id) alert.keeperHubRunId = a.keeper_hub_run_id;
          if (a.explorer_url) alert.explorerUrl = a.explorer_url;
          return alert;
        });

        const digests = data.recentDigests.map((d) => {
          const digest: any = {
            id: d.id,
            reportDate: d.report_date,
            title: d.title,
            summary: d.summary,
            highlights: d.highlights,
            publicationStatus: d.publication_status,
          };
          if (d.analysis) digest.analysis = d.analysis;
          if (d.published_at) digest.publishedAt = d.published_at;
          if (d.registry_tx_hash) digest.registryTxHash = d.registry_tx_hash;
          if (d.source_event_root) digest.sourceEventRoot = d.source_event_root;
          if (d.content_uri) digest.contentUri = d.content_uri;
          if (d.keeper_hub_run_id) digest.keeperHubRunId = d.keeper_hub_run_id;
          if (d.explorer_url) digest.explorerUrl = d.explorer_url;
          return digest;
        });

        const payments = data.recentPayments.map((p) => {
          const payment: any = {
            id: p.id,
            premiumItemId: p.premium_item_id,
            paymentRoute: p.payment_route as "x402" | "mpp",
            status: p.status,
          };
          if (p.settlement_reference) {
            payment.settlementReference = p.settlement_reference;
          }
          return payment;
        });

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

        const payouts = data.recentPayouts.map((p) => {
          const payout: any = {
            id: p.id,
            payoutPeriodHash: p.payout_period_hash,
            recipient: p.recipient,
            amount: p.amount,
            reasonHash: p.reason_hash,
            status: p.status,
            createdAt: p.created_at,
          };
          if (p.payout_tx_hash) payout.payoutTxHash = p.payout_tx_hash;
          if (p.registry_tx_hash) payout.registryTxHash = p.registry_tx_hash;
          if (p.keeper_hub_run_id) payout.keeperHubRunId = p.keeper_hub_run_id;
          if (p.explorer_url) payout.explorerUrl = p.explorer_url;
          if (p.transfer_keeper_hub_run_id) {
            payout.transferKeeperHubRunId = p.transfer_keeper_hub_run_id;
          }
          if (p.transfer_explorer_url) payout.transferExplorerUrl = p.transfer_explorer_url;
          return payout;
        });

        const activeSponsoredWatches = data.activeSponsoredWatches.map((w) => {
          const watch: any = {
            id: w.id,
            targetContract: w.target_contract,
            watchSpecHash: w.watch_spec_hash,
            startsAt: w.starts_at,
            endsAt: w.ends_at,
            status: w.status,
            createdAt: w.created_at,
          };
          if (w.create_tx_hash) watch.createTxHash = w.create_tx_hash;
          if (w.report_tx_hash) watch.reportTxHash = w.report_tx_hash;
          if (w.report_content_hash) watch.reportContentHash = w.report_content_hash;
          if (w.content_uri) watch.contentUri = w.content_uri;
          if (w.create_keeper_hub_run_id) watch.createKeeperHubRunId = w.create_keeper_hub_run_id;
          if (w.create_explorer_url) watch.createExplorerUrl = w.create_explorer_url;
          if (w.report_keeper_hub_run_id) watch.reportKeeperHubRunId = w.report_keeper_hub_run_id;
          if (w.report_explorer_url) watch.reportExplorerUrl = w.report_explorer_url;
          return watch;
        });

        return {
          success: true,
          data: {
            alerts,
            digests,
            payments,
            treasury,
            executionLogs,
            payouts,
            activeSponsoredWatches,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error building activity data",
        };
      }
    },
  };
}
