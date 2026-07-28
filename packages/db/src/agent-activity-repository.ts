// Agent Activity Repository
// Aggregates public activity data for the Live Agent Activity page
// P1-1: parallel queries, SQL analytics RPCs, capped lists

import type { SupabaseClient } from "@supabase/supabase-js";
import { PersistenceError, type Result, failure, success } from "./errors.ts";
import { mapPostgrestError } from "./repository-utils.ts";
import type {
  AffiliateRow,
  DailyDigestRow,
  ExecutionLogRow,
  PaymentRecordRow,
  PublicAlertRow,
  RevenuePayoutRow,
  SponsoredWatchRow,
  TreasurySnapshotRow,
} from "./types.ts";

/** Lightweight payment fields used for public analytics (fallback path). */
export interface ActivityPaymentAnalyticsRow {
  status: string;
  payment_route: string;
  amount_settled: number | null;
  amount_requested: number | null;
  currency: string | null;
  referral_address: string | null;
}

/** Lightweight newsletter fields for MRR + referral attribution (fallback path). */
export interface ActivityNewsletterAnalyticsRow {
  status: string;
  amount_per_period: number;
  currency: string;
  billing_period_days: number;
  referral_address: string | null;
}

/** SQL-backed subscription analytics (activity_subscription_analytics RPC). */
export interface ActivitySubscriptionAnalyticsSnapshot {
  mrr: number;
  mrrCurrency: string;
  activeNewsletterSubscriptions: number;
  settledPayments: number;
  totalPaymentAttempts: number;
  conversionRate: number;
  routeMix: Array<{
    route: string;
    settledCount: number;
    settledVolume: number;
    volumeShare: number;
  }>;
  totalSettledVolume: number;
  referredSettledCount: number;
  referredSettledVolume: number;
}

/** SQL-backed referral attribution (activity_referral_attribution RPC). */
export interface ActivityReferralAttributionSnapshot {
  partners: Array<{
    referralAddress: string;
    displayName: string | null;
    referralCode: string | null;
    affiliateStatus: string | null;
    settledPaymentCount: number;
    attributedVolume: number;
    currency: string;
    newsletterSubscriptionCount: number;
  }>;
  totalReferredVolume: number;
  totalReferredPayments: number;
  currency: string;
}

export interface AgentActivityData {
  recentAlerts: PublicAlertRow[];
  recentDigests: DailyDigestRow[];
  recentPayments: PaymentRecordRow[];
  treasurySnapshots: TreasurySnapshotRow[];
  activeSponsoredWatches: SponsoredWatchRow[];
  recentPayouts: RevenuePayoutRow[];
  recentLogs: ExecutionLogRow[];
  totalMonitoredEvents: number;
  totalQualifiedEvents: number;
  /**
   * Prefer SQL aggregates when present (P1-1). When set, service skips
   * row-sample rebuild of subscription analytics.
   */
  subscriptionAnalyticsSnapshot?: ActivitySubscriptionAnalyticsSnapshot;
  /**
   * Prefer SQL aggregates when present (P1-1). When set, service skips
   * row-sample rebuild of referral attribution.
   */
  referralAttributionSnapshot?: ActivityReferralAttributionSnapshot;
  /** Fallback payment samples when RPC unavailable (tests / older DB). */
  paymentAnalytics: ActivityPaymentAnalyticsRow[];
  /** Fallback newsletter samples when RPC unavailable. */
  newsletterAnalytics: ActivityNewsletterAnalyticsRow[];
  /** Affiliate directory for referral display names (fallback path). */
  affiliates: AffiliateRow[];
}

export interface AgentActivityRepository {
  getActivityData(limitParam?: number): Promise<Result<AgentActivityData>>;
}

const WATCH_CAP = 50;
const ANALYTICS_SAMPLE_LIMIT = 500;

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseSubscriptionSnapshot(
  raw: unknown,
): ActivitySubscriptionAnalyticsSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const routeMixRaw = Array.isArray(o.routeMix) ? o.routeMix : [];
  return {
    mrr: asNumber(o.mrr),
    mrrCurrency: typeof o.mrrCurrency === "string" ? o.mrrCurrency : "USDC",
    activeNewsletterSubscriptions: asNumber(o.activeNewsletterSubscriptions),
    settledPayments: asNumber(o.settledPayments),
    totalPaymentAttempts: asNumber(o.totalPaymentAttempts),
    conversionRate: asNumber(o.conversionRate),
    routeMix: routeMixRaw.map((entry) => {
      const r = (entry ?? {}) as Record<string, unknown>;
      return {
        route: typeof r.route === "string" ? r.route : "unknown",
        settledCount: asNumber(r.settledCount),
        settledVolume: asNumber(r.settledVolume),
        volumeShare: asNumber(r.volumeShare),
      };
    }),
    totalSettledVolume: asNumber(o.totalSettledVolume),
    referredSettledCount: asNumber(o.referredSettledCount),
    referredSettledVolume: asNumber(o.referredSettledVolume),
  };
}

function parseReferralSnapshot(raw: unknown): ActivityReferralAttributionSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const partnersRaw = Array.isArray(o.partners) ? o.partners : [];
  return {
    partners: partnersRaw.map((entry) => {
      const p = (entry ?? {}) as Record<string, unknown>;
      return {
        referralAddress:
          typeof p.referralAddress === "string" ? p.referralAddress : "",
        displayName: typeof p.displayName === "string" ? p.displayName : null,
        referralCode: typeof p.referralCode === "string" ? p.referralCode : null,
        affiliateStatus:
          typeof p.affiliateStatus === "string" ? p.affiliateStatus : null,
        settledPaymentCount: asNumber(p.settledPaymentCount),
        attributedVolume: asNumber(p.attributedVolume),
        currency: typeof p.currency === "string" ? p.currency : "USDC",
        newsletterSubscriptionCount: asNumber(p.newsletterSubscriptionCount),
      };
    }),
    totalReferredVolume: asNumber(o.totalReferredVolume),
    totalReferredPayments: asNumber(o.totalReferredPayments),
    currency: typeof o.currency === "string" ? o.currency : "USDC",
  };
}

export function createAgentActivityRepository(supabase: SupabaseClient): AgentActivityRepository {
  return {
    async getActivityData(limitParam = 10) {
      const limit = Math.min(50, Math.max(1, limitParam));

      try {
        // All independent reads fan out in parallel (P1-1).
        // Analytics prefer SQL RPCs; fall back to capped samples if RPCs missing.
        const [
          alertsResult,
          digestsResult,
          paymentsResult,
          snapshotsResult,
          watchesResult,
          payoutsResult,
          logsResult,
          totalEventsResult,
          qualifiedEventsResult,
          subscriptionRpc,
          referralRpc,
        ] = await Promise.all([
          supabase
            .from("public_alerts")
            .select(
              `
            id, monitored_event_id, title, summary, source_references, audience,
            destinations, delivery_status, published_at, dedupe_key, confidence,
            generation_provider, generation_attempt_ids, registry_tx_hash,
            source_event_hash, content_uri, content_hash, gas_used, gas_used_wei,
            keeper_hub_run_id, explorer_url, created_at, updated_at,
            monitored_events (
              event_type,
              chain_id,
              protocol
            )
          `,
            )
            .order("created_at", { ascending: false })
            .limit(limit),

          supabase
            .from("daily_digests")
            .select(
              `id, report_date, period_start, period_end, title, summary, highlights,
               analysis, source_event_ids, audience, publication_status, published_at,
               registry_tx_hash, source_event_root, content_uri, content_hash, gas_used,
               gas_used_wei, keeper_hub_run_id, explorer_url, created_at, updated_at`,
            )
            .order("created_at", { ascending: false })
            .limit(limit),

          supabase
            .from("payment_records")
            .select(
              `id, premium_item_id, payment_route, payer_reference, referral_address,
               amount_requested, amount_settled, currency, status, challenge_reference,
               settlement_reference, requested_at, settled_at, expires_at, registry_tx_hash,
               keeper_hub_run_id, explorer_url, content_uri, created_at, updated_at`,
            )
            .order("requested_at", { ascending: false })
            .limit(limit),

          supabase
            .from("treasury_snapshots")
            .select("*")
            .order("captured_at", { ascending: false })
            .limit(limit),

          supabase
            .from("sponsored_watches")
            .select("*")
            .in("status", ["accepted", "monitoring"])
            .order("created_at", { ascending: false })
            .limit(WATCH_CAP),

          supabase
            .from("payout_records")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(limit),

          supabase
            .from("execution_logs")
            .select(
              `id, action_type, entity_type, entity_id, status, message, details,
               started_at, completed_at, created_at`,
            )
            .order("created_at", { ascending: false })
            .limit(limit * 3),

          supabase
            .from("monitored_events")
            .select("*", { count: "exact", head: true }),

          supabase
            .from("monitored_events")
            .select("*", { count: "exact", head: true })
            .eq("status", "qualified"),

          supabase.rpc("activity_subscription_analytics"),
          supabase.rpc("activity_referral_attribution"),
        ]);

        if (alertsResult.error) return failure(mapPostgrestError(alertsResult.error));
        if (digestsResult.error) return failure(mapPostgrestError(digestsResult.error));
        if (paymentsResult.error) return failure(mapPostgrestError(paymentsResult.error));
        if (snapshotsResult.error) return failure(mapPostgrestError(snapshotsResult.error));
        if (watchesResult.error) return failure(mapPostgrestError(watchesResult.error));
        if (payoutsResult.error) return failure(mapPostgrestError(payoutsResult.error));
        if (logsResult.error) return failure(mapPostgrestError(logsResult.error));
        if (totalEventsResult.error) {
          return failure(mapPostgrestError(totalEventsResult.error));
        }
        if (qualifiedEventsResult.error) {
          return failure(mapPostgrestError(qualifiedEventsResult.error));
        }

        const mappedAlerts = ((alertsResult.data ?? []) as Array<Record<string, unknown>>).map(
          (row) => {
            const joined = row.monitored_events as
              | { event_type?: string; chain_id?: number; protocol?: string | null }
              | Array<{ event_type?: string; chain_id?: number; protocol?: string | null }>
              | null
              | undefined;
            const event = Array.isArray(joined) ? joined[0] : joined;
            const { monitored_events: _ignored, ...rest } = row;
            return {
              ...(rest as unknown as PublicAlertRow),
              event_type: event?.event_type ?? null,
              chain_id: typeof event?.chain_id === "number" ? event.chain_id : null,
              protocol: event?.protocol ?? null,
            } as PublicAlertRow;
          },
        );

        const subscriptionSnapshot = parseSubscriptionSnapshot(subscriptionRpc.data);
        const referralSnapshot = parseReferralSnapshot(referralRpc.data);
        const rpcAnalyticsOk =
          subscriptionSnapshot != null &&
          referralSnapshot != null &&
          !subscriptionRpc.error &&
          !referralRpc.error;

        let paymentAnalytics: ActivityPaymentAnalyticsRow[] = [];
        let newsletterAnalytics: ActivityNewsletterAnalyticsRow[] = [];
        let affiliates: AffiliateRow[] = [];

        // Fallback path when RPCs are missing (local tests / pre-migration DBs).
        if (!rpcAnalyticsOk) {
          const [paymentAnalyticsResult, newsletterResult, affiliateResult] =
            await Promise.all([
              supabase
                .from("payment_records")
                .select(
                  "status, payment_route, amount_settled, amount_requested, currency, referral_address",
                )
                .order("requested_at", { ascending: false })
                .limit(ANALYTICS_SAMPLE_LIMIT),
              supabase
                .from("x402_newsletter_subscriptions")
                .select(
                  "status, amount_per_period, currency, billing_period_days, referral_address",
                )
                .order("created_at", { ascending: false })
                .limit(ANALYTICS_SAMPLE_LIMIT),
              supabase
                .from("affiliates")
                .select("*")
                .order("created_at", { ascending: false })
                .limit(200),
            ]);

          if (paymentAnalyticsResult.error) {
            return failure(mapPostgrestError(paymentAnalyticsResult.error));
          }
          if (newsletterResult.error) {
            return failure(mapPostgrestError(newsletterResult.error));
          }
          if (affiliateResult.error) {
            return failure(mapPostgrestError(affiliateResult.error));
          }

          paymentAnalytics = (paymentAnalyticsResult.data ??
            []) as ActivityPaymentAnalyticsRow[];
          newsletterAnalytics = (newsletterResult.data ??
            []) as ActivityNewsletterAnalyticsRow[];
          affiliates = (affiliateResult.data ?? []) as unknown as AffiliateRow[];
        }

        const result: AgentActivityData = {
          recentAlerts: mappedAlerts,
          recentDigests: (digestsResult.data ?? []) as unknown as DailyDigestRow[],
          recentPayments: (paymentsResult.data ?? []) as unknown as PaymentRecordRow[],
          treasurySnapshots: (snapshotsResult.data ??
            []) as unknown as TreasurySnapshotRow[],
          activeSponsoredWatches: (watchesResult.data ??
            []) as unknown as SponsoredWatchRow[],
          recentPayouts: (payoutsResult.data ?? []) as unknown as RevenuePayoutRow[],
          recentLogs: (logsResult.data ?? []) as unknown as ExecutionLogRow[],
          totalMonitoredEvents: totalEventsResult.count ?? 0,
          totalQualifiedEvents: qualifiedEventsResult.count ?? 0,
          paymentAnalytics,
          newsletterAnalytics,
          affiliates,
        };

        if (subscriptionSnapshot) {
          result.subscriptionAnalyticsSnapshot = subscriptionSnapshot;
        }
        if (referralSnapshot) {
          result.referralAttributionSnapshot = referralSnapshot;
        }

        return success(result);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error fetching activity data";
        return failure(new PersistenceError(message));
      }
    },
  };
}
