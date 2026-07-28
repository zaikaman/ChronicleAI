import { createHash } from "node:crypto";
import type {
  AffiliateRepository,
  ExecutionLogRepository,
  PaymentRecordRepository,
  PayoutRecordRepository,
  TreasurySnapshotRepository,
} from "@chronicleai/db";
import type { ChronicleRegistryService } from "./chronicle-registry-service.ts";
import type { TreasuryStatusService } from "./treasury-status-service.ts";
import type { Web3Client } from "./web3-client-service.ts";

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export interface RevenueRoutingConfig {
  /** Required payout recipient for creator recovery (EIP-55 address). */
  creatorRecoveryWallet: string;
  /**
   * Max fraction of distributable revenue that may go to affiliates combined (0–1).
   * Default product policy: 0.2 (20%).
   */
  referralRewardShare: number;
  /**
   * Absolute currency-unit cap on total affiliate rewards for a routing period.
   */
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
   * 3. Attribute capped referral rewards to allowlisted affiliates (intent metadata)
   * 4. Send remaining distributable to creator recovery
   * 5. Execute real native transfers from the Para MPC treasury (or KeeperHub / test EOA)
   * 6. Call recordPayout on the registry (KeeperHub / Para / test EOA) with real hashes only
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

/**
 * Normalize and de-dupe approved affiliate wallets (lowercase EVM addresses only).
 * Used with wallets loaded from the `affiliates` registry (not env).
 */
export function normalizeApprovedReferralWallets(
  wallets: readonly string[] | undefined | null,
): Set<string> {
  const approved = new Set<string>();
  if (!wallets) return approved;
  for (const raw of wallets) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!EVM_ADDRESS_RE.test(trimmed)) continue;
    approved.add(trimmed.toLowerCase());
  }
  return approved;
}

/**
 * Attribute settled payment revenue to approved affiliates via referral_address.
 * Does not use payer_reference — payers are never treated as referral partners.
 * Approval set comes from the affiliates table (product registry).
 */
export function attributeReferralRewards(params: {
  payments: ReadonlyArray<{
    status?: string | null;
    amount_settled?: number | null;
    referral_address?: string | null;
  }>;
  approvedReferralWallets: Set<string>;
  /** Max total affiliate pool for this period (currency units). */
  referralPool: number;
}): Map<string, number> {
  const attributedVolume = new Map<string, number>();

  if (params.referralPool <= 0 || params.approvedReferralWallets.size === 0) {
    return new Map();
  }

  for (const payment of params.payments) {
    if (payment.status != null && payment.status !== "settled") continue;
    const referral = payment.referral_address?.trim().toLowerCase();
    if (!referral || !EVM_ADDRESS_RE.test(referral)) continue;
    if (!params.approvedReferralWallets.has(referral)) continue;

    const settled = payment.amount_settled ?? 0;
    if (!(settled > 0) || !Number.isFinite(settled)) continue;

    attributedVolume.set(referral, (attributedVolume.get(referral) ?? 0) + settled);
  }

  const totalAttributed = [...attributedVolume.values()].reduce((a, b) => a + b, 0);
  if (totalAttributed <= 0) {
    return new Map();
  }

  // Pro-rata share of the capped referral pool by attributed settled volume.
  const rewards = new Map<string, number>();
  let allocated = 0;
  const entries = [...attributedVolume.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  for (let i = 0; i < entries.length; i++) {
    const [wallet, volume] = entries[i]!;
    const isLast = i === entries.length - 1;
    const share = volume / totalAttributed;
    const amount = isLast
      ? Math.max(0, params.referralPool - allocated)
      : Math.floor(params.referralPool * share);
    if (amount > 0) {
      rewards.set(wallet, amount);
      allocated += amount;
    }
  }

  return rewards;
}

export function createRevenueRoutingService(
  deps: {
    treasuryRepo: TreasurySnapshotRepository;
    paymentRepo: PaymentRecordRepository;
    payoutRepo: PayoutRecordRepository;
    execLogRepo: ExecutionLogRepository;
    /** Product registry of approved referral partners (website/API). */
    affiliateRepo: AffiliateRepository;
    treasuryService: TreasuryStatusService;
    registryService: ChronicleRegistryService;
    web3Client?: Web3Client | null;
  },
  config: RevenueRoutingConfig,
): RevenueRoutingService {
  const cfg = config;

  if (!cfg.creatorRecoveryWallet || !EVM_ADDRESS_RE.test(cfg.creatorRecoveryWallet)) {
    throw new Error(
      "Revenue routing requires a valid creatorRecoveryWallet (CREATOR_RECOVERY_WALLET)",
    );
  }

  if (!(cfg.ethPerCurrencyUnit > 0) || !Number.isFinite(cfg.ethPerCurrencyUnit)) {
    throw new Error(
      "Revenue routing requires ethPerCurrencyUnit > 0 (REVENUE_ETH_PER_CURRENCY_UNIT)",
    );
  }

  if (
    !(cfg.referralRewardShare >= 0) ||
    !(cfg.referralRewardShare <= 1) ||
    !Number.isFinite(cfg.referralRewardShare)
  ) {
    throw new Error(
      "Revenue routing requires referralRewardShare in [0, 1] (REFERRAL_REWARD_SHARE)",
    );
  }

  if (!(cfg.referralRewardCap >= 0) || !Number.isFinite(cfg.referralRewardCap)) {
    throw new Error(
      "Revenue routing requires referralRewardCap >= 0 (REFERRAL_REWARD_CAP)",
    );
  }

  const creatorWalletNormalized = cfg.creatorRecoveryWallet.toLowerCase();

  return {
    async routeRevenue(periodHashParam?: string) {
      const payoutPeriodHash = periodHashParam ?? `period_${Date.now()}`;

      if (!deps.web3Client) {
        return ZERO_RESULT(
          payoutPeriodHash,
          0,
          "Web3 client not configured — revenue routing requires KeeperHub (KEEPERHUB_API_KEY + KEEPERHUB_API_BASE_URL + CHRONICLE_REGISTRY_ADDRESS) or ALLOW_DIRECT_ETHERS_WRITES for local tests",
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

      // 4. Load approved affiliates from product registry (not env)
      const approvedResult = await deps.affiliateRepo.listApprovedWallets();
      if (!approvedResult.ok) {
        return ZERO_RESULT(
          payoutPeriodHash,
          totalRevenue,
          `Failed to load approved affiliates: ${approvedResult.error.message}`,
        );
      }
      const approvedReferralWallets = normalizeApprovedReferralWallets(approvedResult.value);

      // 5. Affiliate rewards from intent metadata (referral_address), registry-approved only
      const referralPool = Math.min(
        Math.floor(distributable * cfg.referralRewardShare),
        cfg.referralRewardCap,
      );

      let affiliateRewards = new Map<string, number>();
      if (referralPool > 0 && approvedReferralWallets.size > 0) {
        const referredPaymentsResult =
          typeof deps.paymentRepo.listSettledWithReferral === "function"
            ? await deps.paymentRepo.listSettledWithReferral(500)
            : await deps.paymentRepo.list(500);

        if (referredPaymentsResult.ok) {
          const payments = referredPaymentsResult.value.filter(
            (p) => p.status === "settled" && p.referral_address,
          );
          affiliateRewards = attributeReferralRewards({
            payments,
            approvedReferralWallets,
            referralPool,
          });
        }
      }

      // Never pay the creator wallet as an "affiliate" — that is recovery, not referral.
      if (affiliateRewards.has(creatorWalletNormalized)) {
        affiliateRewards.delete(creatorWalletNormalized);
      }

      const referralRewardsAmount = [...affiliateRewards.values()].reduce((a, b) => a + b, 0);
      const creatorRecoveryAmount = Math.max(0, Math.floor(distributable - referralRewardsAmount));

      const payoutIds: string[] = [];
      const payoutAmounts = new Map<string, number>();

      // 5. Creator recovery payout
      if (creatorRecoveryAmount > 0) {
        const creatorResult = await deps.payoutRepo.create({
          payout_period_hash: payoutPeriodHash,
          recipient: cfg.creatorRecoveryWallet,
          amount: creatorRecoveryAmount,
          reason_hash: simpleHash(
            `creator_recovery:${payoutPeriodHash}:${creatorRecoveryAmount}`,
          ),
          status: "pending",
        });

        if (creatorResult.ok) {
          payoutIds.push(creatorResult.value.id);
          payoutAmounts.set(creatorResult.value.id, creatorRecoveryAmount);
        }
      }

      // Affiliate payouts — approved referral partners only
      for (const [affiliateWallet, rewardAmount] of affiliateRewards) {
        if (rewardAmount <= 0) continue;
        if (!EVM_ADDRESS_RE.test(affiliateWallet)) continue;

        const refResult = await deps.payoutRepo.create({
          payout_period_hash: payoutPeriodHash,
          recipient: affiliateWallet,
          amount: rewardAmount,
          reason_hash: simpleHash(
            `referral_reward:${affiliateWallet}:${payoutPeriodHash}:${rewardAmount}`,
          ),
          status: "pending",
        });

        if (refResult.ok) {
          payoutIds.push(refResult.value.id);
          payoutAmounts.set(refResult.value.id, rewardAmount);
        }
      }

      if (payoutIds.length === 0) {
        return ZERO_RESULT(payoutPeriodHash, totalRevenue, "Failed to create any payout records");
      }

      // 6. Execute real on-chain transfers via KeeperHub — no simulated hashes
      const transferHashes = new Map<
        string,
        { txHash: string; keeperHubRunId?: string; explorerUrl?: string }
      >();

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
          const transferReceipt = await web3Client.sendTransfer(recipient, ethAmount);
          transferHashes.set(payoutId, {
            txHash: transferReceipt.txHash,
            keeperHubRunId: transferReceipt.keeperHubRunId,
            explorerUrl: transferReceipt.explorerUrl,
          });
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
              executedViaKeeperHub: web3Client.isKeeperHubBacked(),
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

        const transferMeta = transferHashes.get(payoutId);
        if (!transferMeta) {
          await markPayoutsFailed(deps, payoutIds, "Missing transfer hash");
          return ZERO_RESULT(payoutPeriodHash, totalRevenue, "Missing transfer hash after send");
        }

        const payoutTxHash = transferMeta.txHash;
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
              transfer_keeper_hub_run_id: transferMeta.keeperHubRunId,
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

        await deps.payoutRepo.markTransferred(payoutId, payoutTxHash, registryTxHash, {
          keeperHubRunId: registryResult.keeperHubRunId,
          explorerUrl: registryResult.explorerUrl,
          transferKeeperHubRunId: transferMeta.keeperHubRunId,
          transferExplorerUrl: transferMeta.explorerUrl,
        });

        const viaKh =
          Boolean(registryResult.keeperHubRunId || transferMeta.keeperHubRunId) ||
          web3Client.isKeeperHubBacked();

        await deps.execLogRepo.append({
          action_type: "payout",
          entity_type: "payout_record",
          entity_id: payoutId,
          status: "succeeded",
          message: viaKh
            ? `Executed via KeeperHub: payout transferred and recorded for ${payoutRecord.value.recipient}`
            : `Payout transferred and recorded on-chain for ${payoutRecord.value.recipient}`,
          details: {
            payout_period_hash: payoutPeriodHash,
            payout_tx_hash: payoutTxHash,
            registry_tx_hash: registryTxHash,
            keeper_hub_run_id: registryResult.keeperHubRunId,
            explorer_url: registryResult.explorerUrl,
            transfer_keeper_hub_run_id: transferMeta.keeperHubRunId,
            transfer_explorer_url: transferMeta.explorerUrl,
            amount,
            recipient: payoutRecord.value.recipient,
            executedViaKeeperHub: viaKh,
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
