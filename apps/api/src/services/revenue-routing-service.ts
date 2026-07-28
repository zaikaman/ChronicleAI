import { createHash } from "node:crypto";
import type {
  AffiliateRepository,
  ExecutionLogRepository,
  PaymentRecordRepository,
  PayoutRecordRepository,
  TreasurySnapshotRepository,
} from "@chronicleai/db";
import type { ChronicleRegistryService } from "./chronicle-registry-service.ts";
import type { RevenueFxService } from "./revenue-fx-service.ts";
import type { TreasuryStatusService } from "./treasury-status-service.ts";
import type { Web3Client } from "./web3-client-service.ts";

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export interface RevenueRoutingConfig {
  /** Required payout recipient for creator recovery (EIP-55 address). */
  creatorRecoveryWallet: string;
  /**
   * Max fraction of distributable revenue for creator/deployer recovery (0–1).
   * Default product policy: 0.8 (80%). Env: CREATOR_RECOVERY_SHARE.
   * Remainder stays in treasury (ops + affiliate withdrawal float).
   */
  creatorRecoveryShare: number;
  /**
   * @deprecated Automatic revenue routing no longer pays affiliates.
   * Affiliates earn via settlement credits and withdraw through the affiliate agent.
   * Kept optional so older call sites keep compiling.
   */
  referralRewardShare?: number;
  /**
   * @deprecated Not used by automatic routing (affiliates withdraw separately).
   * Kept optional for older call sites.
   */
  referralRewardCap?: number;
  /** 0–1, max fraction of excess balance to distribute. Env: MAX_PAYOUT_SHARE. */
  maxPayoutShare: number;
  /**
   * Minimum ms between routing runs (scheduling / anti-double-run guard).
   * Env: ROUTING_INTERVAL_MS.
   */
  routingIntervalMs: number;
  /**
   * Authoritative safety buffer (TREASURY_SAFETY_BUFFER). When set, overrides
   * the latest snapshot's safety_buffer for routing eligibility (ETH gas).
   */
  safetyBuffer?: number;
  /**
   * USDC retained as operating reserve before distribution (IDEA Loop 5 step 2).
   * Default 0 when unset. Lower for demo so micro-payouts fire more often.
   */
  usdcOperatingReserve?: number;
  /**
   * Minimum net distributable USDC before creating payouts (default 0.01).
   * Allows sub-dollar micro-payouts for hackathon demo cadence.
   * Env: REVENUE_MIN_DISTRIBUTABLE_USDC.
   */
  minDistributableUsdc?: number;
}

export interface RevenueRoutingResult {
  routed: boolean;
  totalRevenue: number;
  creatorRecoveryAmount: number;
  /**
   * Always 0 — affiliates are not paid by automatic routing.
   * They withdraw earned balances via the affiliate agent path.
   */
  referralRewardsAmount: number;
  /** Estimated generation + transaction costs subtracted before distribution. */
  estimatedOperatingCosts?: number;
  /** USDC operating reserve retained. */
  usdcOperatingReserve?: number;
  /** Net amount after costs/reserve used as the distribution ceiling. */
  distributable?: number;
  payoutPeriodHash: string;
  payoutIds: string[];
  registryTxHash?: string;
  errorMessage?: string;
}

export interface RevenueRoutingService {
  /**
   * Execute autonomous revenue routing (IDEA Loop 5).
   * 1. Aggregate settled x402/MPP revenue
   * 2. Subtract estimated gas/API costs + USDC operating reserve
   * 3. Send creator recovery share only (affiliates withdraw separately)
   * 4. Execute real USDC transfer + record recordPayout (real hashes only)
   * 5. Skip with a logged reason when the safety buffer / interval is not met
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
    /**
     * @deprecated Automatic routing no longer attributes affiliate referrals for transfers.
     * Optional for older call sites.
     */
    paymentRepo?: PaymentRecordRepository;
    payoutRepo: PayoutRecordRepository;
    execLogRepo: ExecutionLogRepository;
    /**
     * @deprecated Automatic routing no longer loads affiliates for payouts.
     * Affiliates withdraw via the affiliate agent. Optional for older call sites.
     */
    affiliateRepo?: AffiliateRepository;
    treasuryService: TreasuryStatusService;
    registryService: ChronicleRegistryService;
    web3Client?: Web3Client | null;
    /**
     * @deprecated Payouts are USDC 1:1 with payment accounting units — FX is unused.
     * Kept optional so older call sites keep compiling until fully removed.
     */
    fxService?: RevenueFxService;
  },
  config: RevenueRoutingConfig,
): RevenueRoutingService {
  const cfg = config;

  if (!cfg.creatorRecoveryWallet || !EVM_ADDRESS_RE.test(cfg.creatorRecoveryWallet)) {
    throw new Error(
      "Revenue routing requires a valid creatorRecoveryWallet (CREATOR_RECOVERY_WALLET)",
    );
  }

  if (
    !(cfg.creatorRecoveryShare >= 0) ||
    !(cfg.creatorRecoveryShare <= 1) ||
    !Number.isFinite(cfg.creatorRecoveryShare)
  ) {
    throw new Error(
      "Revenue routing requires creatorRecoveryShare in [0, 1] (CREATOR_RECOVERY_SHARE)",
    );
  }

  if (
    !(cfg.maxPayoutShare >= 0) ||
    !(cfg.maxPayoutShare <= 1) ||
    !Number.isFinite(cfg.maxPayoutShare)
  ) {
    throw new Error(
      "Revenue routing requires maxPayoutShare in [0, 1] (MAX_PAYOUT_SHARE)",
    );
  }

  if (!(cfg.routingIntervalMs > 0) || !Number.isFinite(cfg.routingIntervalMs)) {
    throw new Error(
      "Revenue routing requires routingIntervalMs > 0 (ROUTING_INTERVAL_MS)",
    );
  }

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

      // 2. Check treasury status + routing interval guard
      const latestSnapshot = await deps.treasuryRepo.findLatest();
      const availableBalance = latestSnapshot.ok
        ? (latestSnapshot.value?.available_balance ?? 0)
        : 0;
      const safetyBuffer =
        cfg.safetyBuffer ??
        (latestSnapshot.ok ? (latestSnapshot.value?.safety_buffer ?? 0.01) : 0.01);

      if (latestSnapshot.ok && latestSnapshot.value?.last_routed_at) {
        const lastRoutedMs = Date.parse(latestSnapshot.value.last_routed_at);
        if (!Number.isNaN(lastRoutedMs)) {
          const elapsed = Date.now() - lastRoutedMs;
          if (elapsed < cfg.routingIntervalMs) {
            return ZERO_RESULT(
              payoutPeriodHash,
              totalRevenue,
              `Routing interval not elapsed (${elapsed}ms < ${cfg.routingIntervalMs}ms ROUTING_INTERVAL_MS)`,
            );
          }
        }
      }

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

      // 3. Subtract estimated gas/API costs + USDC operating reserve (IDEA Loop 5 step 2)
      const estimatedGenerationCost =
        latestSnapshot.ok && latestSnapshot.value
          ? (latestSnapshot.value.estimated_generation_cost ?? 0)
          : 0;
      const estimatedTransactionCost =
        latestSnapshot.ok && latestSnapshot.value
          ? (latestSnapshot.value.estimated_transaction_cost ?? 0)
          : 0;
      const estimatedOperatingCosts = Math.max(
        0,
        estimatedGenerationCost + estimatedTransactionCost,
      );
      const usdcOperatingReserve = Math.max(0, cfg.usdcOperatingReserve ?? 0);

      const revenueAfterCosts = Math.max(0, totalRevenue - estimatedOperatingCosts);
      const revenueAfterReserve = Math.max(0, revenueAfterCosts - usdcOperatingReserve);

      // Excess above safety buffer caps period distribution (same unit as snapshot balance).
      // Net revenue (after costs + USDC reserve) is the other ceiling.
      const excessBalance = Math.max(0, availableBalance - safetyBuffer);
      // Round to USDC 6dp (not integer floor) so sub-dollar micro-payouts work for demos.
      const rawDistributable = Math.min(
        excessBalance * cfg.maxPayoutShare,
        revenueAfterReserve,
      );
      const distributable = Math.floor(rawDistributable * 1e6) / 1e6;
      const minDistributable = Math.max(0, cfg.minDistributableUsdc ?? 0.01);

      if (distributable < minDistributable) {
        return ZERO_RESULT(
          payoutPeriodHash,
          totalRevenue,
          `No distributable revenue after costs/reserve/buffer (revenue=${totalRevenue}, costs=${estimatedOperatingCosts}, usdcReserve=${usdcOperatingReserve}, excessBalance=${excessBalance}, distributable=${distributable}, minDistributable=${minDistributable})`,
        );
      }

      // 4. Payouts are USDC 1:1 with settled payment currency units (x402).
      const fxMeta = { source: "usdc_1_1" as const, ethUsdPrice: null as number | null };

      // 5. Creator recovery only — affiliates credit on settlement and withdraw via agent.
      const referralRewardsAmount = 0;
      const creatorRecoveryAmount =
        Math.floor(distributable * cfg.creatorRecoveryShare * 1e6) / 1e6;

      const payoutIds: string[] = [];
      const payoutAmounts = new Map<string, number>();

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

      if (payoutIds.length === 0) {
        return ZERO_RESULT(
          payoutPeriodHash,
          totalRevenue,
          creatorRecoveryAmount <= 0
            ? "Creator recovery amount is zero after share policy"
            : "Failed to create any payout records",
        );
      }

      // 8. Execute real on-chain USDC transfers — no simulated hashes
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
        // amount is already human USDC units from payment aggregation
        const usdcAmount = amount;

        try {
          const transferReceipt = await web3Client.sendTransfer(recipient, usdcAmount);
          transferHashes.set(payoutId, {
            txHash: transferReceipt.txHash,
            ...(transferReceipt.keeperHubRunId
              ? { keeperHubRunId: transferReceipt.keeperHubRunId }
              : {}),
            ...(transferReceipt.explorerUrl
              ? { explorerUrl: transferReceipt.explorerUrl }
              : {}),
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
              amount_usdc: usdcAmount,
              asset: "USDC",
              fx_source: fxMeta.source,
              executedViaKeeperHub: web3Client.isKeeperHubBacked(),
            },
          });
          return ZERO_RESULT(
            payoutPeriodHash,
            totalRevenue,
            `On-chain USDC transfer failed: ${message}`,
          );
        }
      }

      // 9. Record each payout on the registry with real transfer hashes
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
          ...(registryResult.keeperHubRunId
            ? { keeperHubRunId: registryResult.keeperHubRunId }
            : {}),
          ...(registryResult.explorerUrl ? { explorerUrl: registryResult.explorerUrl } : {}),
          ...(transferMeta.keeperHubRunId
            ? { transferKeeperHubRunId: transferMeta.keeperHubRunId }
            : {}),
          ...(transferMeta.explorerUrl
            ? { transferExplorerUrl: transferMeta.explorerUrl }
            : {}),
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
            amount_usdc: amount,
            asset: "USDC",
            fx_source: fxMeta.source,
            policy: {
              creatorRecoveryShare: cfg.creatorRecoveryShare,
              maxPayoutShare: cfg.maxPayoutShare,
              routingIntervalMs: cfg.routingIntervalMs,
              affiliatePayouts: "manual_withdraw_only",
            },
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
        estimatedOperatingCosts,
        usdcOperatingReserve,
        distributable,
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
