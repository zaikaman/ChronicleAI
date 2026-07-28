// KeeperHub revenue routing handler
// Processes signed revenue routing requests and triggers creator-only payouts (Loop 5).
// Affiliates withdraw separately via the affiliate agent.

import type { RevenueRoutingPayload } from "@chronicleai/schemas";
import type { ExecutionLogRepository } from "@chronicleai/db";
import type { RevenueRoutingService } from "../services/revenue-routing-service.ts";

export interface RevenueRoutingResult {
  accepted: boolean;
  statusCode: number;
  payoutCount: number;
  message: string;
}

export class RevenueRoutingHandler {
  private readonly routingService: RevenueRoutingService;
  private readonly execLogRepo: ExecutionLogRepository;

  constructor(deps: {
    routingService: RevenueRoutingService;
    execLogRepo: ExecutionLogRepository;
  }) {
    this.routingService = deps.routingService;
    this.execLogRepo = deps.execLogRepo;
  }

  async route(payload: RevenueRoutingPayload, _source = "keeperhub"): Promise<RevenueRoutingResult> {
    try {
      // Log routing started
      await this.execLogRepo.append({
        action_type: "payout",
        entity_type: "payout_record",
        entity_id: null,
        status: "started",
        message: "Revenue routing triggered",
        details: {
          payout_period_hash: payload.periodHash,
          force: payload.force ?? false,
        },
      });

      // Execute revenue routing
      const result = await this.routingService.routeRevenue(payload.periodHash);

      if (!result.routed) {
        await this.execLogRepo.append({
          action_type: "payout",
          entity_type: "payout_record",
          entity_id: null,
          status: "failed",
          message: `Revenue routing skipped: ${result.errorMessage}`,
          details: {
            total_revenue: result.totalRevenue,
            reason: result.errorMessage,
          },
        });

        return {
          accepted: true,
          statusCode: 201,
          payoutCount: 0,
          message: `Revenue routing skipped: ${result.errorMessage}`,
        };
      }

      // Log routing completed
      await this.execLogRepo.append({
        action_type: "payout",
        entity_type: "payout_record",
        entity_id: null,
        status: "succeeded",
        message: `Revenue routed: ${result.payoutIds.length} payout(s) executed`,
        details: {
          payout_period_hash: result.payoutPeriodHash,
          total_revenue: result.totalRevenue,
          creator_recovery_amount: result.creatorRecoveryAmount,
          referral_rewards_amount: result.referralRewardsAmount,
          payout_count: result.payoutIds.length,
          payout_ids: result.payoutIds,
          registry_tx_hash: result.registryTxHash,
        },
      });

      // Log payout transferred for each payout
      for (const payoutId of result.payoutIds) {
        await this.execLogRepo.append({
          action_type: "payout",
          entity_type: "payout_record",
          entity_id: payoutId,
          status: "succeeded",
          message: "Payout transferred on-chain",
          details: {
            payout_period_hash: result.payoutPeriodHash,
            registry_tx_hash: result.registryTxHash,
          },
        });
      }

      return {
        accepted: true,
        statusCode: 201,
        payoutCount: result.payoutIds.length,
        message: `Revenue routed: ${result.payoutIds.length} payout(s) executed, $${result.totalRevenue} total revenue`,
      };
    } catch (error) {
      await this.execLogRepo.append({
        action_type: "payout",
        entity_type: "payout_record",
        entity_id: null,
        status: "failed",
        message: `Revenue routing failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        details: {},
      });

      return {
        accepted: false,
        statusCode: 500,
        payoutCount: 0,
        message: `Revenue routing failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }
}
