import { createHash } from "node:crypto";
import type {
  ExecutionLogRepository,
  PaymentRecordRepository,
  PayoutRecordRepository,
  TreasurySnapshotRepository,
} from "@chronicleai/db";
import type { ChronicleRegistryService } from "./chronicle-registry-service.ts";
import type { TreasuryStatusService } from "./treasury-status-service.ts";
import type { Web3Client } from "./web3-client-service.ts";

export interface RevenueRoutingConfig {
  /** Required payout recipient for creator recovery (EIP-55 address). */
  creatorRecoveryWallet: string;
  referralRewardCap: number;
  maxPayoutShare: number; // 0-1, max fraction of excess balance to distribute
  routingIntervalMs: number;
  /**
   * Converts currency-unit payout amounts (e.g. USDC dollars) into native ETH
   * for `sendTransfer`. Set via REVENUE_ETH_PER_CURRENCY_UNIT.
   * Example: 1e-6 means 1_000 currency units → 0.001 ETH.
   */
  ethPerCurrencyUnit: number;
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
   * 5. Execute real native transfers from the treasury wallet (TREASURY_WALLET_PRIVATE_KEY)
   * 6. Call recordPayout on the registry (Para key) with real hashes only
   */
  routeRevenue(periodHash?: string): Promise<RevenueRoutingResult>;
}

const ZERO_RESULT = (
  payoutPeriodHash: string,
  totalRevenue: number,
  errorMessage: string,
): RevenueRoutingResult => ({
  routed: false,
  totalRevenue,
  creatorRecoveryAmount: 0,
  referralRewardsAmount: 0,
  payoutPeriodHash,
  payoutIds: [],
  errorMessage,
});

export function createRevenueRoutingService(
  deps: {
    treasuryRepo: TreasurySnapshotRepository;
    paymentRepo: PaymentRecordRepository;
    payoutRepo: PayoutRecordRepository;
    execLogRepo: ExecutionLogRepository;
    treasuryService: TreasuryStatusService;
    registryService: ChronicleRegistryService;
    web3Client?: Web3Client | null;
  },
  config: RevenueRoutingConfig,
): RevenueRoutingService {
  const cfg = config;

  if (!cfg.creatorRecoveryWallet || !/^0x[a-fA-F0-9]{40}$/.test(cfg.creatorRecoveryWallet)) {
    throw new Error(
      "Revenue routing requires a valid creatorRecoveryWallet (CREATOR_RECOVERY_WALLET)",
    );
  }

  if (!(cfg.ethPerCurrencyUnit > 0) || !Number.isFinite(cfg.ethPerCurrencyUnit)) {
    throw new Error(
      "Revenue routing requires ethPerCurrencyUnit > 0 (REVENUE_ETH_PER_CURRENCY_UNIT)",
    );
  }

  return {
    async routeRevenue(periodHashParam?: string) {
      const payoutPeriodHash = periodHashParam ?? `period_${Date.now()}`;

      if (!deps.web3Client) {
        return ZERO_RESULT(
          payoutPeriodHash,
          0,
          "Web3 client not configured — revenue routing requires RPC_URL, CHRONICLE_REGISTRY_ADDRESS, PARA_WALLET_PRIVATE_KEY (registry), and TREASURY_WALLET_PRIVATE_KEY (payout transfers)",
        );
      }

      const web3Client = deps.web3Client;

      // 1. Aggregate revenue since last routing
      const aggregateResult = await deps.treasuryRepo.getAggregates();

      if (!aggregateResult.ok) {
        return ZERO_RESULT(
          payoutPeriodHash,
          0,
          `Failed to aggregate revenue: ${aggregateResult.error.message}`,
        );
      }

      const { totalRevenue } = aggregateResult.value;

      // 2. Check treasury status
      const latestSnapshot = await deps.treasuryRepo.findLatest();
      const availableBalance = latestSnapshot.ok
        ? (latestSnapshot.value?.available_balance ?? 0)
        : 0;
      const safetyBuffer = latestSnapshot.ok ? (latestSnapshot.value?.safety_buffer ?? 1000) : 1000;

      const routeCheck = deps.treasuryService.shouldRouteRevenue(
        availableBalance,
        safetyBuffer,
        totalRevenue,
      );

      if (!routeCheck.canRoute) {
        return ZERO_RESULT(
          payoutPeriodHash,
          totalRevenue,
          routeCheck.reason ?? "Revenue routing conditions not met",
        );
      }

      // 3. Calculate distributable amount
      const excessBalance = availableBalance - safetyBuffer;
      const distributable = Math.min(excessBalance * cfg.maxPayoutShare, totalRevenue);

      if (distributable <= 0) {
        return ZERO_RESULT(
          payoutPeriodHash,
          totalRevenue,
          "No distributable revenue after safety buffer",
        );
      }

      // 4. Split between creator recovery and referral rewards
      const creatorRecoveryAmount = Math.floor(distributable * 0.8); // 80% to creator
      const referralRewardsAmount = Math.min(
        Math.floor(distributable * 0.2), // 20% to referrals
        cfg.referralRewardCap,
      );

      const payoutIds: string[] = [];
      const payoutAmounts = new Map<string, number>();

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
        payoutAmounts.set(creatorResult.value.id, creatorRecoveryAmount);
      }

      // Create referral payout records based on settled payments
      const recentPaymentsResult = await deps.paymentRepo.list(50);
      if (recentPaymentsResult.ok) {
        const settledPayments = recentPaymentsResult.value.filter(
          (p) => p.status === "settled" && p.payer_reference,
        );

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
            if (!/^0x[a-fA-F0-9]{40}$/.test(payerRef)) {
              // Skip non-address payer references (e.g. mpp-client-*) — cannot transfer on-chain
              continue;
            }
            const refResult = await deps.payoutRepo.create({
              payout_period_hash: payoutPeriodHash,
              recipient: payerRef,
              amount: rewardAmount,
              reason_hash: simpleHash(`referral_reward:${payerRef}:${payoutPeriodHash}`),
              status: "pending",
            });

            if (refResult.ok) {
              payoutIds.push(refResult.value.id);
              payoutAmounts.set(refResult.value.id, rewardAmount);
            }
          }
        }
      }

      if (payoutIds.length === 0) {
        return ZERO_RESULT(payoutPeriodHash, totalRevenue, "Failed to create any payout records");
      }

      // 6. Execute real on-chain transfers — no simulated hashes
      const transferHashes = new Map<string, string>();

      for (const payoutId of payoutIds) {
        const amount = payoutAmounts.get(payoutId) ?? 0;
        const payoutRecord = await deps.payoutRepo.findById(payoutId);
        if (!payoutRecord.ok || !payoutRecord.value) {
          await markPayoutsFailed(deps, payoutIds, "Payout record missing after create");
          return ZERO_RESULT(payoutPeriodHash, totalRevenue, "Payout record missing after create");
        }

        const recipient = payoutRecord.value.recipient;
        const ethAmount = amount * cfg.ethPerCurrencyUnit;

        try {
          const payoutTxHash = await web3Client.sendTransfer(recipient, ethAmount);
          transferHashes.set(payoutId, payoutTxHash);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown transfer error";
          await markPayoutsFailed(deps, payoutIds, message);
          await deps.execLogRepo.append({
            action_type: "payout",
            entity_type: "payout_record",
            entity_id: payoutId,
            status: "failed",
            message: `On-chain transfer failed: ${message}`,
            details: {
              payout_period_hash: payoutPeriodHash,
              recipient,
              amount,
              eth_amount: ethAmount,
            },
          });
          return ZERO_RESULT(
            payoutPeriodHash,
            totalRevenue,
            `On-chain transfer failed: ${message}`,
          );
        }
      }

      // 7. Record each payout on the registry with real transfer hashes
      let finalRegistryTxHash: string | undefined;

      for (const payoutId of payoutIds) {
        const payoutRecord = await deps.payoutRepo.findById(payoutId);
        if (!payoutRecord.ok || !payoutRecord.value) {
          continue;
        }

        const payoutTxHash = transferHashes.get(payoutId);
        if (!payoutTxHash) {
          await markPayoutsFailed(deps, payoutIds, "Missing transfer hash");
          return ZERO_RESULT(payoutPeriodHash, totalRevenue, "Missing transfer hash after send");
        }

        const amount = payoutAmounts.get(payoutId) ?? payoutRecord.value.amount;
        const registryResult = await deps.registryService.recordPayout(
          payoutPeriodHash,
          payoutRecord.value.recipient,
          amount,
          payoutTxHash,
        );

        if (!registryResult.success || !registryResult.txHash) {
          const message = registryResult.errorMessage ?? "Registry recordPayout failed";
          await markPayoutsFailed(deps, payoutIds, message);
          await deps.execLogRepo.append({
            action_type: "payout",
            entity_type: "payout_record",
            entity_id: payoutId,
            status: "failed",
            message: `Registry recordPayout failed: ${message}`,
            details: {
              payout_period_hash: payoutPeriodHash,
              payout_tx_hash: payoutTxHash,
            },
          });
          return ZERO_RESULT(
            payoutPeriodHash,
            totalRevenue,
            `Registry recordPayout failed: ${message}`,
          );
        }

        const registryTxHash = registryResult.txHash;
        if (!finalRegistryTxHash) {
          finalRegistryTxHash = registryTxHash;
        }

        await deps.payoutRepo.markTransferred(payoutId, payoutTxHash, registryTxHash);

        await deps.execLogRepo.append({
          action_type: "payout",
          entity_type: "payout_record",
          entity_id: payoutId,
          status: "succeeded",
          message: `Payout transferred and recorded on-chain for ${payoutRecord.value.recipient}`,
          details: {
            payout_period_hash: payoutPeriodHash,
            payout_tx_hash: payoutTxHash,
            registry_tx_hash: registryTxHash,
            amount,
            recipient: payoutRecord.value.recipient,
          },
        });
      }

      // Update treasury snapshot with routing info
      if (latestSnapshot.ok && latestSnapshot.value) {
        const updateFields: Record<string, unknown> = {
          last_routed_at: new Date().toISOString(),
          last_payout_period_hash: payoutPeriodHash,
          total_routed_amount: (latestSnapshot.value.total_routed_amount ?? 0) + distributable,
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
        ...(finalRegistryTxHash ? { registryTxHash: finalRegistryTxHash } : {}),
      };
    },
  };
}

async function markPayoutsFailed(
  deps: {
    payoutRepo: PayoutRecordRepository;
    execLogRepo: ExecutionLogRepository;
  },
  payoutIds: string[],
  reason: string,
): Promise<void> {
  for (const payoutId of payoutIds) {
    if (typeof deps.payoutRepo.markFailed === "function") {
      await deps.payoutRepo.markFailed(payoutId);
    }
    await deps.execLogRepo.append({
      action_type: "payout",
      entity_type: "payout_record",
      entity_id: payoutId,
      status: "failed",
      message: `Payout failed: ${reason}`,
      details: { reason },
    });
  }
}

function simpleHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
