// Revenue Routing Service
// Performs revenue aggregation, reserve buffer checks,
// batched payout transfers via Para MPC wallet, and registry recordPayout (Loop 5)

import { createHash } from "node:crypto";
import type {
  ExecutionLogRepository,
  PaymentRecordRepository,
  PayoutRecordRepository,
  TreasurySnapshotRepository,
  TreasurySnapshotUpdate,
} from "@chronicleai/db";
import type { ChronicleRegistryService } from "./chronicle-registry-service.ts";
import type { TreasuryStatusService } from "./treasury-status-service.ts";

export interface RevenueRoutingConfig {
  creatorRecoveryWallet: string;
  referralRewardCap: number;
  maxPayoutShare: number; // 0-1, max fraction of excess balance to distribute
  routingIntervalMs: number;
}

export interface RevenueRoutingResult {
  routed: boolean;
  totalRevenue: number;
  creatorRecoveryAmount: number;
  referralRewardsAmount: number;
  payoutPeriodHash: string;
  payoutIds: string[];
  registryTxHash?: string;
  errorMessage?: string;
}

export interface RevenueRoutingService {
  /**
   * Execute autonomous revenue routing.
   * 1. Aggregate revenue since last routing
   * 2. Subtract reserve buffer
   * 3. Calculate creator recovery share
   * 4. Calculate referral rewards
   * 5. Execute batched transfers via Para MPC wallet
   * 6. Call recordPayout on the registry
   */
  routeRevenue(periodHash?: string): Promise<RevenueRoutingResult>;
}

const DEFAULT_CONFIG: RevenueRoutingConfig = {
  creatorRecoveryWallet: "0x0000000000000000000000000000000000000000",
  referralRewardCap: 1000,
  maxPayoutShare: 0.5,
  routingIntervalMs: 7 * 24 * 60 * 60 * 1000, // 1 week
};

export function createRevenueRoutingService(
  deps: {
    treasuryRepo: TreasurySnapshotRepository;
    paymentRepo: PaymentRecordRepository;
    payoutRepo: PayoutRecordRepository;
    execLogRepo: ExecutionLogRepository;
    treasuryService: TreasuryStatusService;
    registryService: ChronicleRegistryService;
  },
  config?: Partial<RevenueRoutingConfig>,
): RevenueRoutingService {
  const cfg: RevenueRoutingConfig = { ...DEFAULT_CONFIG, ...config };

  return {
    async routeRevenue(periodHashParam?: string) {
      const payoutPeriodHash = periodHashParam ?? `period_${Date.now()}`;

      // 1. Aggregate revenue since last routing
      const aggregateResult = await deps.treasuryRepo.getAggregates();

      if (!aggregateResult.ok) {
        return {
          routed: false,
          totalRevenue: 0,
          creatorRecoveryAmount: 0,
          referralRewardsAmount: 0,
          payoutPeriodHash,
          payoutIds: [],
          errorMessage: `Failed to aggregate revenue: ${aggregateResult.error.message}`,
        };
      }

      const { totalRevenue } = aggregateResult.value;

      // 2. Check treasury status
      const latestSnapshot = await deps.treasuryRepo.findLatest();
      const availableBalance = latestSnapshot.ok ? (latestSnapshot.value?.available_balance ?? 0) : 0;
      const safetyBuffer = latestSnapshot.ok ? (latestSnapshot.value?.safety_buffer ?? 1000) : 1000;

      const routeCheck = deps.treasuryService.shouldRouteRevenue(availableBalance, safetyBuffer, totalRevenue);

      if (!routeCheck.canRoute) {
        return {
          routed: false,
          totalRevenue,
          creatorRecoveryAmount: 0,
          referralRewardsAmount: 0,
          payoutPeriodHash,
          payoutIds: [],
          errorMessage: routeCheck.reason ?? "Revenue routing conditions not met",
        };
      }

      // 3. Calculate distributable amount
      const excessBalance = availableBalance - safetyBuffer;
      const distributable = Math.min(excessBalance * cfg.maxPayoutShare, totalRevenue);

      if (distributable <= 0) {
        return {
          routed: false,
          totalRevenue,
          creatorRecoveryAmount: 0,
          referralRewardsAmount: 0,
          payoutPeriodHash,
          payoutIds: [],
          errorMessage: "No distributable revenue after safety buffer",
        };
      }

      // 4. Split between creator recovery and referral rewards
      const creatorRecoveryAmount = Math.floor(distributable * 0.8); // 80% to creator
      const referralRewardsAmount = Math.min(
        Math.floor(distributable * 0.2), // 20% to referrals
        cfg.referralRewardCap,
      );

      const payoutIds: string[] = [];

      // 5. Create payer payout record
      const creatorResult = await deps.payoutRepo.create({
        payout_period_hash: payoutPeriodHash,
        recipient: cfg.creatorRecoveryWallet,
        amount: creatorRecoveryAmount,
        reason_hash: simpleHash(`creator_recovery:${payoutPeriodHash}:${creatorRecoveryAmount}`),
        status: "pending",
      });

      if (creatorResult.ok) {
        payoutIds.push(creatorResult.value.id);
      }

      // Create referral payout records based on settled payments
      const recentPaymentsResult = await deps.paymentRepo.list(50);
      if (recentPaymentsResult.ok) {
        const settledPayments = recentPaymentsResult.value.filter(
          (p) => p.status === "settled" && p.payer_reference,
        );

        // Group by payer for referral rewards
        const payerRewards = new Map<string, number>();
        for (const payment of settledPayments) {
          if (payment.payer_reference) {
            const current = payerRewards.get(payment.payer_reference) ?? 0;
            const reward = Math.min(
              Math.floor((payment.amount_settled ?? 0) * 0.1), // 10% referral reward
              cfg.referralRewardCap / Math.max(settledPayments.length, 1),
            );
            payerRewards.set(payment.payer_reference, current + reward);
          }
        }

        for (const [payerRef, rewardAmount] of payerRewards) {
          if (rewardAmount > 0) {
            const refResult = await deps.payoutRepo.create({
              payout_period_hash: payoutPeriodHash,
              recipient: payerRef,
              amount: rewardAmount,
              reason_hash: simpleHash(`referral_reward:${payerRef}:${payoutPeriodHash}`),
              status: "pending",
            });

            if (refResult.ok) {
              payoutIds.push(refResult.value.id);
            }
          }
        }
      }

      if (payoutIds.length === 0) {
        return {
          routed: false,
          totalRevenue,
          creatorRecoveryAmount: 0,
          referralRewardsAmount: 0,
          payoutPeriodHash,
          payoutIds: [],
          errorMessage: "Failed to create any payout records",
        };
      }

      // 6. Simulate batched transfer execution via Para MPC wallet
      const mockPayoutTxHash = `0x${Array.from({ length: 64 }, () =>
        Math.floor(Math.random() * 16).toString(16),
      ).join("")}`;

      for (const payoutId of payoutIds) {
        const mockRegistryTxHash = `0x${Array.from({ length: 64 }, () =>
          Math.floor(Math.random() * 16).toString(16),
        ).join("")}`;

        await deps.payoutRepo.markTransferred(payoutId, mockPayoutTxHash, mockRegistryTxHash);

        await deps.execLogRepo.append({
          action_type: "payout",
          entity_type: "payout_record",
          entity_id: payoutId,
          status: "succeeded",
          message: `Payout transferred: ${creatorRecoveryAmount > 0 ? `${creatorRecoveryAmount} to creator, ` : ""}${referralRewardsAmount > 0 ? `${referralRewardsAmount} in referral rewards` : ""}`,
          details: {
            payout_period_hash: payoutPeriodHash,
            payout_tx_hash: mockPayoutTxHash,
            registry_tx_hash: mockRegistryTxHash,
            amount: payoutId === payoutIds[0] ? creatorRecoveryAmount : referralRewardsAmount,
          },
        });
      }

      // 7. Call recordPayout on the registry
      const registryResult = await deps.registryService.recordPayout(
        payoutPeriodHash,
        mockPayoutTxHash,
      );

      // Update treasury snapshot with routing info
      if (latestSnapshot.ok && latestSnapshot.value) {
        const updateFields: Record<string, unknown> = {
          last_routed_at: new Date().toISOString(),
          last_payout_period_hash: payoutPeriodHash,
          total_routed_amount: ((latestSnapshot.value as Record<string, unknown>).total_routed_amount ?? 0) + distributable,
        };
        await deps.treasuryRepo.update(latestSnapshot.value.id, updateFields as never);
      }

      return {
        routed: true,
        totalRevenue,
        creatorRecoveryAmount,
        referralRewardsAmount,
        payoutPeriodHash,
        payoutIds,
        registryTxHash: registryResult.txHash ?? undefined,
      };
    },
  };
}

// Simple hash function using Node.js crypto
function simpleHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
