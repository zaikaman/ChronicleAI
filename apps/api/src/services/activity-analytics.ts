// Pure analytics for the public Activity trail: MRR, conversion, route mix, referral attribution.

import type {
  PaymentRouteMixEntry,
  ReferralAttribution,
  ReferralAttributionPartner,
  SubscriptionAnalytics,
} from "@chronicleai/schemas";

export interface AnalyticsPaymentRow {
  status: string;
  payment_route: string;
  amount_settled: number | null;
  amount_requested: number | null;
  currency: string | null;
  referral_address: string | null;
}

export interface AnalyticsNewsletterRow {
  status: string;
  amount_per_period: number;
  currency: string;
  billing_period_days: number;
  referral_address: string | null;
}

export interface AnalyticsAffiliateRow {
  wallet_address: string;
  display_name: string | null;
  referral_code: string | null;
  status: string;
}

const ENTITLED_NEWSLETTER_STATUSES = new Set(["active", "past_due"]);

/**
 * Normalize a recurring charge to a 30-day monthly equivalent.
 * e.g. weekly $7 → MRR contribution of $7 * (30/7).
 */
export function normalizeToMonthlyMrr(
  amountPerPeriod: number,
  billingPeriodDays: number,
): number {
  if (!Number.isFinite(amountPerPeriod) || amountPerPeriod <= 0) return 0;
  const days =
    Number.isFinite(billingPeriodDays) && billingPeriodDays > 0 ? billingPeriodDays : 30;
  return (amountPerPeriod * 30) / days;
}

export function buildSubscriptionAnalytics(
  payments: AnalyticsPaymentRow[],
  newsletters: AnalyticsNewsletterRow[],
): SubscriptionAnalytics {
  const entitled = newsletters.filter((n) => ENTITLED_NEWSLETTER_STATUSES.has(n.status));
  let mrr = 0;
  let mrrCurrency = "USDC";
  for (const sub of entitled) {
    mrr += normalizeToMonthlyMrr(sub.amount_per_period, sub.billing_period_days);
    if (sub.currency) mrrCurrency = sub.currency;
  }

  const totalPaymentAttempts = payments.length;
  const settled = payments.filter((p) => p.status === "settled");
  const settledPayments = settled.length;
  const conversionRate =
    totalPaymentAttempts > 0 ? settledPayments / totalPaymentAttempts : 0;

  const routeBuckets = new Map<string, { settledCount: number; settledVolume: number }>();
  let totalSettledVolume = 0;
  let referredSettledCount = 0;
  let referredSettledVolume = 0;

  for (const p of settled) {
    const volume =
      typeof p.amount_settled === "number" && Number.isFinite(p.amount_settled)
        ? p.amount_settled
        : typeof p.amount_requested === "number" && Number.isFinite(p.amount_requested)
          ? p.amount_requested
          : 0;
    totalSettledVolume += volume;

    const route = p.payment_route || "unknown";
    const bucket = routeBuckets.get(route) ?? { settledCount: 0, settledVolume: 0 };
    bucket.settledCount += 1;
    bucket.settledVolume += volume;
    routeBuckets.set(route, bucket);

    if (p.referral_address) {
      referredSettledCount += 1;
      referredSettledVolume += volume;
    }
  }

  const routeMix: PaymentRouteMixEntry[] = [...routeBuckets.entries()]
    .map(([route, bucket]) => ({
      route,
      settledCount: bucket.settledCount,
      settledVolume: roundMoney(bucket.settledVolume),
      volumeShare:
        totalSettledVolume > 0 ? bucket.settledVolume / totalSettledVolume : 0,
    }))
    .sort((a, b) => b.settledVolume - a.settledVolume);

  return {
    mrr: roundMoney(mrr),
    mrrCurrency,
    activeNewsletterSubscriptions: entitled.length,
    settledPayments,
    totalPaymentAttempts,
    conversionRate: roundRatio(conversionRate),
    routeMix,
    totalSettledVolume: roundMoney(totalSettledVolume),
    referredSettledCount,
    referredSettledVolume: roundMoney(referredSettledVolume),
  };
}

export function buildReferralAttribution(
  payments: AnalyticsPaymentRow[],
  newsletters: AnalyticsNewsletterRow[],
  affiliates: AnalyticsAffiliateRow[],
): ReferralAttribution {
  const affiliateByWallet = new Map<string, AnalyticsAffiliateRow>();
  for (const a of affiliates) {
    const key = a.wallet_address.trim().toLowerCase();
    if (key) affiliateByWallet.set(key, a);
  }

  const partners = new Map<
    string,
    {
      settledPaymentCount: number;
      attributedVolume: number;
      currency: string;
      newsletterSubscriptionCount: number;
    }
  >();

  const ensure = (addr: string) => {
    const key = addr.trim().toLowerCase();
    let row = partners.get(key);
    if (!row) {
      row = {
        settledPaymentCount: 0,
        attributedVolume: 0,
        currency: "USDC",
        newsletterSubscriptionCount: 0,
      };
      partners.set(key, row);
    }
    return { key, row };
  };

  for (const p of payments) {
    if (p.status !== "settled" || !p.referral_address) continue;
    const { row } = ensure(p.referral_address);
    const volume =
      typeof p.amount_settled === "number" && Number.isFinite(p.amount_settled)
        ? p.amount_settled
        : typeof p.amount_requested === "number" && Number.isFinite(p.amount_requested)
          ? p.amount_requested
          : 0;
    row.settledPaymentCount += 1;
    row.attributedVolume += volume;
    if (p.currency) row.currency = p.currency;
  }

  for (const n of newsletters) {
    if (!n.referral_address) continue;
    const { row } = ensure(n.referral_address);
    row.newsletterSubscriptionCount += 1;
    if (n.currency) row.currency = n.currency;
  }

  const partnerList: ReferralAttributionPartner[] = [...partners.entries()]
    .map(([referralAddress, stats]) => {
      const affiliate = affiliateByWallet.get(referralAddress);
      return {
        referralAddress,
        displayName: affiliate?.display_name ?? null,
        referralCode: affiliate?.referral_code ?? null,
        affiliateStatus: affiliate?.status ?? null,
        settledPaymentCount: stats.settledPaymentCount,
        attributedVolume: roundMoney(stats.attributedVolume),
        currency: stats.currency,
        newsletterSubscriptionCount: stats.newsletterSubscriptionCount,
      };
    })
    .sort((a, b) => b.attributedVolume - a.attributedVolume || b.settledPaymentCount - a.settledPaymentCount);

  const totalReferredVolume = partnerList.reduce((sum, p) => sum + p.attributedVolume, 0);
  const totalReferredPayments = partnerList.reduce((sum, p) => sum + p.settledPaymentCount, 0);
  const currency = partnerList[0]?.currency ?? "USDC";

  return {
    partners: partnerList,
    totalReferredVolume: roundMoney(totalReferredVolume),
    totalReferredPayments,
    currency,
  };
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function roundRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10_000) / 10_000;
}
