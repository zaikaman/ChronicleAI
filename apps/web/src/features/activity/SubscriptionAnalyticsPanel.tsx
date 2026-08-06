// Live revenue strip for the Premium storefront.
// Headline settlement numbers + payment route mix, up top where they act as
// proof-of-life; the full per-transaction trail lives on the activity Money feed.

import type { ReactElement } from "react";
import { Link } from "react-router-dom";

export interface SubscriptionAnalyticsData {
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

interface SubscriptionAnalyticsPanelProps {
  analytics: SubscriptionAnalyticsData;
  "data-testid"?: string;
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.length === 3 ? currency : "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function routeLabel(route: string): string {
  const lower = route.toLowerCase();
  if (lower === "x402") return "x402 (Base)";
  if (lower === "mpp") return "MPP (Tempo)";
  return route.toUpperCase();
}

export function SubscriptionAnalyticsPanel({
  analytics,
  "data-testid": dataTestId = "subscription-analytics-panel",
}: SubscriptionAnalyticsPanelProps): ReactElement {
  return (
    <div
      data-testid={dataTestId}
      className="rounded-2xl border border-border bg-frame p-4 sm:p-5"
      aria-label="Live revenue"
    >
      {/* Header: live signal + trail link */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
          <h2 className="text-sm font-semibold text-foreground m-0">Live revenue</h2>
          <span className="text-[11px] text-muted-foreground hidden sm:inline">
            settled on-chain · updated with each payment
          </span>
        </div>
        <Link
          to="/activity?filter=money"
          className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors shrink-0"
          data-testid="analytics-money-trail-link"
        >
          Money trail →
        </Link>
      </div>

      {/* Headline metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric
          label="MRR"
          value={formatMoney(analytics.mrr, analytics.mrrCurrency)}
          hint="Recurring paid access"
          testId="analytics-mrr"
        />
        <Metric
          label="Settled volume"
          value={formatMoney(analytics.totalSettledVolume, analytics.mrrCurrency)}
          hint="All premium rails"
          testId="analytics-volume"
        />
        <Metric
          label="Conversion"
          value={formatPercent(analytics.conversionRate)}
          hint={`${analytics.settledPayments} settled / ${analytics.totalPaymentAttempts} attempts`}
          testId="analytics-conversion"
        />
        <Metric
          label="Subscribers"
          value={String(analytics.activeNewsletterSubscriptions)}
          hint="Active newsletter subscriptions"
          testId="analytics-subscribers"
        />
      </div>

      {/* Payment route mix */}
      <div className="mt-4 pt-4 border-t border-border/50">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2.5">
          Payment route mix
        </p>
        {analytics.routeMix.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="route-mix-empty">
            No settled payments yet — route mix appears after the first successful settlement.
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5" data-testid="route-mix-list">
            {analytics.routeMix.map((entry) => (
              <li key={entry.route} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-foreground">{routeLabel(entry.route)}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatMoney(entry.settledVolume, analytics.mrrCurrency)} ·{" "}
                    {formatPercent(entry.volumeShare)} · {entry.settledCount} tx
                  </span>
                </div>
                <div
                  className="h-1 rounded-full bg-muted overflow-hidden"
                  role="presentation"
                  aria-hidden
                >
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-300"
                    style={{ width: `${Math.max(2, entry.volumeShare * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  testId,
}: {
  label: string;
  value: string;
  hint: string;
  testId: string;
}): ReactElement {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-3" data-testid={testId}>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
      <p className="text-xl font-semibold text-foreground tabular-nums tracking-tight">{value}</p>
      <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{hint}</p>
    </div>
  );
}
