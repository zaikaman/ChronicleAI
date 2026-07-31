// Agent Activity Service
// Aggregates public dashboard data under one typed response
// P1-1: short TTL cache + single-flight; prefer SQL analytics snapshots

import type { AgentActivityRepository } from "@chronicleai/db";
import type {
  AgentActivityResponse,
  DailyDigestResponse,
  PaymentRecordResponse,
  PublicAlertResponse,
  ReferralAttribution,
  SubscriptionAnalytics,
  TreasuryStatus,
} from "@chronicleai/schemas";
import {
  buildReferralAttribution,
  buildSubscriptionAnalytics,
} from "./activity-analytics.ts";
import {
  buildRegistryRoutingDetails,
  buildTransferRoutingDetails,
  routingBadgeLabel,
  type RoutingPolicyEnv,
} from "./routing-metadata.ts";
import { serializePublicActivityLog } from "./public-activity-serializer.ts";
import type { LiveTreasuryBalances } from "./treasury-balances.ts";

export interface AgentActivityService {
  getActivity(): Promise<{
    success: boolean;
    data?: AgentActivityResponse;
    error?: string;
  }>;
}

/** Dual-rail capital plane snapshot for public Activity / treasury panel. */
export interface DualRailActivityTreasury {
  walletAddress?: string;
  baseUsdc: number;
  sepoliaUsdc: number;
  baseEth?: number;
  sepoliaEth?: number;
  inFlightCctpUsdc: number;
  deployableToDeskUsdc: number;
  usdcOperatingReserve: number;
  cctpEnabled: boolean;
  capitalPlaneNote?: string;
  recentTransfers?: AgentActivityResponse["cctpRebalances"];
}

export interface AgentActivityServiceOptions {
  /**
   * Optional live dual-asset balances (ETH gas + USDC revenue).
   * Best-effort: snapshot values remain the fallback when this fails or returns null.
   * Sepolia pocket preferred for usdcBalance (desk ops rail).
   */
  getLiveTreasuryBalances?: () => Promise<LiveTreasuryBalances | null>;
  /**
   * Optional dual-rail (Base + Sepolia) + CCTP in-flight for treasury panel.
   * When present, overrides single-rail USDC and adds Base/Sepolia split.
   */
  getDualRailTreasury?: () => Promise<DualRailActivityTreasury | null>;
  /**
   * In-process response cache TTL (ms). Default 20s.
   * Set 0 to disable (tests). Live treasury is still fetched inside the cache window
   * only on miss — cached responses include treasury as of last full build.
   */
  cacheTtlMs?: number;
  /** Optional routing policy environment override for badges (default Sepolia defaults). */
  routingEnv?: RoutingPolicyEnv;
}

const DEFAULT_CACHE_TTL_MS = 20_000;

interface CacheEntry {
  expiresAt: number;
  value: {
    success: boolean;
    data?: AgentActivityResponse;
    error?: string;
  };
}

export function createAgentActivityService(
  activityRepo: AgentActivityRepository,
  options?: AgentActivityServiceOptions,
): AgentActivityService {
  const cacheTtlMs =
    typeof options?.cacheTtlMs === "number" ? Math.max(0, options.cacheTtlMs) : DEFAULT_CACHE_TTL_MS;
  const activeRoutingEnv: RoutingPolicyEnv = options?.routingEnv ?? {
    deskUsePrivateMempool: true,
    deskPrivateMempoolStrict: true,
    registryUsePrivateMempool: false,
    routingProviderLabel: "flashbots_protect",
  };

  let cache: CacheEntry | null = null;
  let inFlight: Promise<{
    success: boolean;
    data?: AgentActivityResponse;
    error?: string;
  }> | null = null;

  async function buildActivity(): Promise<{
    success: boolean;
    data?: AgentActivityResponse;
    error?: string;
  }> {
    try {
      // Live treasury RPCs run in parallel with the DB aggregate (P1-1).
      const [activityResult, liveBalances, dualRailResult] = await Promise.all([
        activityRepo.getActivityData(10),
        options?.getLiveTreasuryBalances
          ? options.getLiveTreasuryBalances().catch((error) => {
              console.warn(
                "[activity] Live treasury balances failed; using snapshot:",
                error instanceof Error ? error.message : error,
              );
              return null;
            })
          : Promise.resolve(null),
        options?.getDualRailTreasury
          ? options.getDualRailTreasury().catch((error) => {
              console.warn(
                "[activity] Dual-rail treasury load failed:",
                error instanceof Error ? error.message : error,
              );
              return null;
            })
          : Promise.resolve(null),
      ]);

      if (!activityResult.ok) {
        return {
          success: false,
          error: `Failed to fetch activity data: ${activityResult.error.message}`,
        };
      }

      const data = activityResult.value;

      const latestSnapshot = data.treasurySnapshots[0];
      const safetyBuffer = latestSnapshot?.safety_buffer ?? 0;
      // Snapshot gas figures; live ETH/USDC preferred when provider is wired.
      let ethBalance = latestSnapshot?.available_balance ?? 0;
      let currency = latestSnapshot?.currency ?? "ETH";
      let usdcBalance = 0;
      let walletAddress: string | undefined;
      let hasLiveUsdc = false;
      let dualRail: DualRailActivityTreasury | null = dualRailResult;

      if (liveBalances) {
        ethBalance = liveBalances.ethBalance;
        currency = "ETH";
        usdcBalance = liveBalances.usdcBalance;
        walletAddress = liveBalances.walletAddress;
        hasLiveUsdc = true;
      }

      if (dualRail) {
        usdcBalance = dualRail.sepoliaUsdc;
        hasLiveUsdc = true;
        if (dualRail.walletAddress) walletAddress = dualRail.walletAddress;
        if (dualRail.sepoliaEth != null && Number.isFinite(dualRail.sepoliaEth)) {
          ethBalance = dualRail.sepoliaEth;
          currency = "ETH";
        }
      }

      const treasury: AgentActivityResponse["treasury"] = {
        // availableBalance remains the gas (ETH) figure used for health gating.
        availableBalance: ethBalance,
        safetyBuffer,
        currency,
        status: (latestSnapshot?.status ?? "unknown") as TreasuryStatus,
        ethBalance,
        estimatedGenerationCost: latestSnapshot?.estimated_generation_cost ?? null,
        estimatedTransactionCost: latestSnapshot?.estimated_transaction_cost ?? null,
        paidRequestCount: latestSnapshot?.paid_request_count ?? null,
        revenueTotal: latestSnapshot?.revenue_total ?? null,
      };
      if (hasLiveUsdc) treasury.usdcBalance = usdcBalance;
      if (walletAddress) treasury.walletAddress = walletAddress;
      if (latestSnapshot?.captured_at) treasury.capturedAt = latestSnapshot.captured_at;

      if (dualRail) {
        treasury.baseUsdcBalance = dualRail.baseUsdc;
        treasury.sepoliaUsdcBalance = dualRail.sepoliaUsdc;
        treasury.usdcBalance = dualRail.sepoliaUsdc;
        treasury.inFlightCctpUsdc = dualRail.inFlightCctpUsdc;
        treasury.deployableToDeskUsdc = dualRail.deployableToDeskUsdc;
        treasury.usdcOperatingReserve = dualRail.usdcOperatingReserve;
        treasury.cctpEnabled = dualRail.cctpEnabled;
        if (dualRail.baseEth != null) treasury.baseEthBalance = dualRail.baseEth;
        if (dualRail.sepoliaEth != null) {
          treasury.sepoliaEthBalance = dualRail.sepoliaEth;
        }
        if (dualRail.capitalPlaneNote) {
          treasury.capitalPlaneNote = dualRail.capitalPlaneNote;
        }
      }

      const alerts: PublicAlertResponse[] = data.recentAlerts.map((a) => {
        const alert: PublicAlertResponse = {
          id: a.id,
          title: a.title,
          summary: a.summary,
          sourceReferences: a.source_references,
          deliveryStatus: a.delivery_status as PublicAlertResponse["deliveryStatus"],
          publishedAt: a.published_at ?? a.created_at,
        };
        if (a.confidence) {
          alert.confidence = a.confidence;
        }
        if (a.generation_provider) {
          alert.generationProvider = a.generation_provider;
        }
        if (a.registry_tx_hash) alert.registryTxHash = a.registry_tx_hash;
        if (a.source_event_hash) alert.sourceEventHash = a.source_event_hash;
        if (a.content_hash) alert.contentHash = a.content_hash;
        if (a.content_uri) alert.contentUri = a.content_uri;
        if (a.gas_used) alert.gasUsed = a.gas_used;
        if (a.gas_used_wei) alert.gasUsedWei = a.gas_used_wei;
        if (a.keeper_hub_run_id) alert.keeperHubRunId = a.keeper_hub_run_id;
        if (a.explorer_url) alert.explorerUrl = a.explorer_url;
        if (a.event_type) alert.eventType = a.event_type;
        if (typeof a.chain_id === "number") alert.chainId = a.chain_id;
        if (a.protocol) alert.protocol = a.protocol;
        return alert;
      });

      const digests: DailyDigestResponse[] = data.recentDigests.map((d) => {
        const digest: DailyDigestResponse = {
          id: d.id,
          reportDate: d.report_date,
          title: d.title,
          summary: d.summary,
          highlights: d.highlights,
          publicationStatus: d.publication_status as DailyDigestResponse["publicationStatus"],
        };
        if (d.analysis) digest.analysis = d.analysis;
        if (d.published_at) digest.publishedAt = d.published_at;
        if (d.registry_tx_hash) digest.registryTxHash = d.registry_tx_hash;
        if (d.source_event_root) digest.sourceEventRoot = d.source_event_root;
        if (d.content_hash) digest.contentHash = d.content_hash;
        if (d.content_uri) digest.contentUri = d.content_uri;
        if (d.gas_used) digest.gasUsed = d.gas_used;
        if (d.gas_used_wei) digest.gasUsedWei = d.gas_used_wei;
        if (d.keeper_hub_run_id) digest.keeperHubRunId = d.keeper_hub_run_id;
        if (d.explorer_url) digest.explorerUrl = d.explorer_url;
        return digest;
      });

      const payments: PaymentRecordResponse[] = data.recentPayments.map((p) => {
        const payment: PaymentRecordResponse = {
          id: p.id,
          premiumItemId: p.premium_item_id,
          paymentRoute: p.payment_route as PaymentRecordResponse["paymentRoute"],
          status: p.status as PaymentRecordResponse["status"],
        };
        if (p.settlement_reference) {
          payment.settlementReference = p.settlement_reference;
        }
        if (typeof p.amount_requested === "number") {
          payment.amountRequested = p.amount_requested;
        }
        if (typeof p.amount_settled === "number") {
          payment.amountSettled = p.amount_settled;
        }
        if (p.currency) payment.currency = p.currency;
        if (p.referral_address) payment.referralAddress = p.referral_address;
        if (p.requested_at) payment.requestedAt = p.requested_at;
        if (p.settled_at) payment.settledAt = p.settled_at;
        if (p.registry_tx_hash) payment.registryTxHash = p.registry_tx_hash;
        if (p.keeper_hub_run_id) payment.keeperHubRunId = p.keeper_hub_run_id;
        if (p.explorer_url) payment.explorerUrl = p.explorer_url;
        if (p.content_uri) payment.contentUri = p.content_uri;
        return payment;
      });

      const executionLogs = data.recentLogs.map(serializePublicActivityLog);

      const payouts = data.recentPayouts.map((p) => {
        const payout: Record<string, unknown> = {
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
        if (p.keeper_hub_run_id) {
          payout.keeperHubRunId = p.keeper_hub_run_id;
          const regRouting = buildRegistryRoutingDetails(activeRoutingEnv);
          payout.routing = regRouting.routing;
          payout.routingRequested = regRouting.routingRequested;
          payout.routingApplied = regRouting.routingApplied;
          payout.routingLabel = routingBadgeLabel(regRouting);
        }
        if (p.explorer_url) payout.explorerUrl = p.explorer_url;
        if (p.transfer_keeper_hub_run_id) {
          payout.transferKeeperHubRunId = p.transfer_keeper_hub_run_id;
          if (!payout.routing) {
            const transferRouting = buildTransferRoutingDetails(activeRoutingEnv);
            payout.routing = transferRouting.routing;
            payout.routingRequested = transferRouting.routingRequested;
            payout.routingApplied = transferRouting.routingApplied;
            payout.routingLabel = routingBadgeLabel(transferRouting);
          }
        }
        if (p.transfer_explorer_url) payout.transferExplorerUrl = p.transfer_explorer_url;
        return payout;
      });

      const activeSponsoredWatches = data.activeSponsoredWatches.map((w) => {
        const watch: Record<string, unknown> = {
          id: w.id,
          targetContract: w.target_contract,
          watchSpecHash: w.watch_spec_hash,
          startsAt: w.starts_at,
          endsAt: w.ends_at,
          status: w.status,
          createdAt: w.created_at,
          monitoredEventCount: w.monitored_event_count ?? 0,
        };
        if (w.on_chain_watch_id != null) watch.onChainWatchId = w.on_chain_watch_id;
        if (w.create_tx_hash) watch.createTxHash = w.create_tx_hash;
        if (w.report_tx_hash) watch.reportTxHash = w.report_tx_hash;
        if (w.report_content_hash) watch.reportContentHash = w.report_content_hash;
        if (w.source_event_root) watch.sourceEventRoot = w.source_event_root;
        if (w.content_uri) watch.contentUri = w.content_uri;
        if (w.create_keeper_hub_run_id) watch.createKeeperHubRunId = w.create_keeper_hub_run_id;
        if (w.create_explorer_url) watch.createExplorerUrl = w.create_explorer_url;
        if (w.report_keeper_hub_run_id) watch.reportKeeperHubRunId = w.report_keeper_hub_run_id;
        if (w.report_explorer_url) watch.reportExplorerUrl = w.report_explorer_url;
        if (w.last_monitored_at) watch.lastMonitoredAt = w.last_monitored_at;
        watch.auditTrail = {
          createTxHash: w.create_tx_hash ?? null,
          createExplorerUrl: w.create_explorer_url ?? null,
          reportTxHash: w.report_tx_hash ?? null,
          reportExplorerUrl: w.report_explorer_url ?? null,
          sourceEventRoot: w.source_event_root ?? null,
        };
        return watch;
      });

      let subscriptionAnalytics: SubscriptionAnalytics;
      if (data.subscriptionAnalyticsSnapshot) {
        subscriptionAnalytics = data.subscriptionAnalyticsSnapshot;
      } else {
        const paymentAnalyticsSource =
          data.paymentAnalytics.length > 0
            ? data.paymentAnalytics
            : data.recentPayments.map((p) => ({
                status: p.status,
                payment_route: p.payment_route,
                amount_settled: p.amount_settled,
                amount_requested: p.amount_requested,
                currency: p.currency,
                referral_address: p.referral_address,
              }));
        subscriptionAnalytics = buildSubscriptionAnalytics(
          paymentAnalyticsSource,
          data.newsletterAnalytics,
        );
      }

      let referralAttribution: ReferralAttribution;
      if (data.referralAttributionSnapshot) {
        referralAttribution = data.referralAttributionSnapshot;
      } else {
        const paymentAnalyticsSource =
          data.paymentAnalytics.length > 0
            ? data.paymentAnalytics
            : data.recentPayments.map((p) => ({
                status: p.status,
                payment_route: p.payment_route,
                amount_settled: p.amount_settled,
                amount_requested: p.amount_requested,
                currency: p.currency,
                referral_address: p.referral_address,
              }));
        referralAttribution = buildReferralAttribution(
          paymentAnalyticsSource,
          data.newsletterAnalytics,
          data.affiliates.map((a) => ({
            wallet_address: a.wallet_address,
            display_name: a.display_name,
            referral_code: a.referral_code,
            status: a.status,
          })),
        );
      }

      const responseData: AgentActivityResponse = {
        alerts,
        digests,
        payments,
        treasury,
        executionLogs,
        payouts,
        activeSponsoredWatches,
        subscriptionAnalytics,
        referralAttribution,
      };
      if (dualRail?.recentTransfers && dualRail.recentTransfers.length > 0) {
        responseData.cctpRebalances = dualRail.recentTransfers;
      }

      return {
        success: true,
        data: responseData,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error building activity data",
      };
    }
  }

  return {
    async getActivity() {
      if (cacheTtlMs > 0 && cache && cache.expiresAt > Date.now()) {
        return cache.value;
      }

      if (inFlight) {
        return inFlight;
      }

      inFlight = buildActivity()
        .then((value) => {
          if (cacheTtlMs > 0 && value.success) {
            cache = {
              expiresAt: Date.now() + cacheTtlMs,
              value,
            };
          }
          return value;
        })
        .finally(() => {
          inFlight = null;
        });

      return inFlight;
    },
  };
}
