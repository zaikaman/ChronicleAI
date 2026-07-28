import type { ReactElement } from "react";

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
      className="rounded-2xl border border-border bg-frame p-5 sm:p-6 flex flex-col gap-5"
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric
          label="MRR"
          value={formatMoney(analytics.mrr, analytics.mrrCurrency)}
          hint={`${analytics.activeNewsletterSubscriptions} active newsletter${analytics.activeNewsletterSubscriptions === 1 ? "" : "s"}`}
          testId="analytics-mrr"
        />
        <Metric
          label="Conversion"
          value={formatPercent(analytics.conversionRate)}
          hint={`${analytics.settledPayments} settled / ${analytics.totalPaymentAttempts} attempts`}
          testId="analytics-conversion"
        />
        <Metric
          label="Settled volume"
          value={formatMoney(analytics.totalSettledVolume, analytics.mrrCurrency)}
          hint="All premium rails"
          testId="analytics-volume"
        />
        <Metric
          label="Referred volume"
          value={formatMoney(analytics.referredSettledVolume, analytics.mrrCurrency)}
          hint={`${analytics.referredSettledCount} referred payment${analytics.referredSettledCount === 1 ? "" : "s"}`}
          testId="analytics-referred"
        />
      </div>

      <div>
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">
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
                  className="h-1.5 rounded-full bg-muted overflow-hidden"
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
