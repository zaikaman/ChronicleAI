// Public low-balance warning banner (IDEA Loop 3)
// Surfaces when treasury status is warning or critical, with utility metrics.

import type React from "react";

export interface LowBalanceBannerData {
  status: string;
  availableBalance: number;
  safetyBuffer: number;
  currency?: string;
  ethBalance?: number;
  estimatedGenerationCost?: number | null;
  estimatedTransactionCost?: number | null;
  paidRequestCount?: number | null;
  revenueTotal?: number | null;
}

interface LowBalanceBannerProps {
  treasury: LowBalanceBannerData;
  "data-testid"?: string;
}

function formatAmount(amount: number, currency: string): string {
  const code = currency.toUpperCase();
  const digits = code === "ETH" ? 4 : 2;
  return `${amount.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  })} ${code}`;
}

/**
 * Prominent public warning when agent gas runway is below the safety buffer.
 */
export function LowBalanceBanner({
  treasury,
  "data-testid": dataTestId = "low-balance-banner",
}: LowBalanceBannerProps): React.ReactElement | null {
  if (treasury.status !== "warning" && treasury.status !== "critical") {
    return null;
  }

  const isCritical = treasury.status === "critical";
  const eth =
    typeof treasury.ethBalance === "number" ? treasury.ethBalance : treasury.availableBalance;
  const currency = treasury.currency ?? "ETH";
  const deficitPct =
    treasury.safetyBuffer > 0
      ? Math.max(0, ((treasury.safetyBuffer - eth) / treasury.safetyBuffer) * 100)
      : 0;

  const borderColor = isCritical ? "rgba(239, 68, 68, 0.35)" : "rgba(245, 158, 11, 0.35)";
  const bgColor = isCritical ? "rgba(239, 68, 68, 0.08)" : "rgba(245, 158, 11, 0.08)";
  const accent = isCritical ? "var(--accent-error)" : "var(--accent-warning)";

  return (
    <div
      role="alert"
      data-testid={dataTestId}
      className="rounded-2xl border p-5 sm:p-6 mb-2"
      style={{ background: bgColor, borderColor }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <p
            className="text-xs font-semibold uppercase tracking-wide mb-1"
            style={{ color: accent }}
          >
            {isCritical ? "Critical low balance" : "Low balance warning"}
          </p>
          <h3 className="text-base font-semibold text-foreground m-0">
            Agent gas runway is below the safety buffer
          </h3>
          <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed max-w-2xl">
            Registry writes are suspended until the Para MPC treasury is above{" "}
            {formatAmount(treasury.safetyBuffer, currency)}. Public utility metrics below reflect
            recent operating demand. Private routing on Sepolia requires desk wallet Sepolia ETH for
            gas — private submission disables KeeperHub gas sponsorship.
          </p>
        </div>
        <span
          className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold shrink-0"
          style={{ color: accent, borderColor }}
        >
          {deficitPct.toFixed(0)}% below buffer
        </span>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <Metric
          label="Gas balance"
          value={formatAmount(eth, currency)}
          testId="low-balance-eth"
        />
        <Metric
          label="Safety buffer"
          value={formatAmount(treasury.safetyBuffer, currency)}
          testId="low-balance-buffer"
        />
        <Metric
          label="Est. generation cost"
          value={
            treasury.estimatedGenerationCost != null
              ? formatAmount(treasury.estimatedGenerationCost, "USDC")
              : "—"
          }
          testId="low-balance-gen-cost"
        />
        <Metric
          label="Est. transaction cost"
          value={
            treasury.estimatedTransactionCost != null
              ? formatAmount(treasury.estimatedTransactionCost, "USDC")
              : "—"
          }
          testId="low-balance-tx-cost"
        />
      </dl>

      {(treasury.revenueTotal != null || treasury.paidRequestCount != null) && (
        <p className="mt-3 text-xs text-muted-foreground">
          {treasury.revenueTotal != null
            ? `Settled revenue ${formatAmount(treasury.revenueTotal, "USDC")}`
            : null}
          {treasury.revenueTotal != null && treasury.paidRequestCount != null ? " · " : null}
          {treasury.paidRequestCount != null
            ? `${treasury.paidRequestCount} paid request(s)`
            : null}
        </p>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId: string;
}): React.ReactElement {
  return (
    <div className="rounded-xl border border-border/50 bg-frame/50 px-3 py-2" data-testid={testId}>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-foreground m-0">{value}</dd>
    </div>
  );
}
