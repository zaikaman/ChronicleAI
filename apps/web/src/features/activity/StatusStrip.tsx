// Compact status strip for the activity page.
// One row replaces the old treasury panel + low-balance banner + stat-tile wall:
// gas health, deployable USDC, in-flight transfer, and headline counts.

import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { SectionLink } from "../../components/page-chrome.tsx";
import type { AgentActivityData } from "./use-agent-activity.ts";

interface StatusStripProps {
  treasury: AgentActivityData["treasury"] | null;
  stats: {
    alerts: number;
    settledPayments: number;
    deskTrades: number;
    payouts: number;
  };
  "data-testid"?: string;
}

interface StripStat {
  label: string;
  value: string;
  title?: string;
}

function formatAssetAmount(amount: number, currency: string): string {
  const code = (currency || "ETH").toUpperCase();
  const abs = Math.abs(amount);
  let maxFractionDigits = 4;
  if (code === "USDC" || code === "USDT" || code === "DAI" || code === "EURC") {
    maxFractionDigits = abs >= 1 || abs === 0 ? 2 : 4;
  } else if (abs >= 1000) {
    maxFractionDigits = 2;
  } else if (abs === 0) {
    maxFractionDigits = 0;
  }
  return `${amount.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  })} ${code}`;
}

export function StatusStrip({
  treasury,
  stats,
  "data-testid": dataTestId = "activity-status-strip",
}: StatusStripProps): ReactElement {
  const statCells: StripStat[] = [
    {
      label: "Gas",
      value: treasury
        ? formatAssetAmount(treasury.availableBalance, treasury.currency ?? "ETH")
        : "—",
      title: "Gas runway vs safety buffer",
    },
    {
      label: "Deployable to desk",
      value:
        treasury && typeof treasury.deployableToDeskUsdc === "number"
          ? formatAssetAmount(treasury.deployableToDeskUsdc, "USDC")
          : treasury && typeof treasury.usdcBalance === "number"
            ? formatAssetAmount(treasury.usdcBalance, "USDC")
            : "—",
      title: "Sepolia USDC available for desk funding",
    },
    {
      label: "In flight",
      value:
        treasury && typeof treasury.inFlightCctpUsdc === "number" && treasury.inFlightCctpUsdc > 0
          ? formatAssetAmount(treasury.inFlightCctpUsdc, "USDC")
          : "—",
      title: "Revenue awaiting the desk network",
    },
  ];

  const countCells: StripStat[] = [
    { label: "Alerts", value: String(stats.alerts) },
    { label: "Settlements", value: String(stats.settledPayments) },
    { label: "Desk trades", value: String(stats.deskTrades) },
    { label: "Payouts", value: String(stats.payouts) },
  ];

  const unhealthy = treasury && treasury.status !== "healthy" ? treasury.status : null;

  return (
    <section
      data-testid={dataTestId}
      aria-label="Agent status"
      className={`rounded-2xl border p-4 sm:p-5 transition-colors ${
        unhealthy === "critical"
          ? "border-red-500/30 bg-red-500/5"
          : unhealthy === "warning"
            ? "border-amber-500/30 bg-amber-500/5"
            : "border-border bg-frame"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex items-center gap-2.5 shrink-0">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              unhealthy === "critical"
                ? "bg-[var(--accent-error)]"
                : unhealthy === "warning"
                  ? "bg-[var(--accent-warning)]"
                  : "bg-[var(--accent-success)]"
            }`}
            aria-hidden="true"
          />
          <span className="text-sm font-semibold text-foreground">
            {unhealthy === "critical"
              ? "Gas critical"
              : unhealthy === "warning"
                ? "Gas low"
                : "Gas healthy"}
          </span>
          {unhealthy ? (
            <Link
              to="/desk"
              className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              Open desk →
            </Link>
          ) : null}
        </div>

        <div className="hidden sm:block h-6 w-px bg-border" aria-hidden="true" />

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {statCells.map((cell) => (
            <div key={cell.label} title={cell.title} className="min-w-0">
              <p className="text-[11px] text-muted-foreground">{cell.label}</p>
              <p className="text-sm font-semibold tabular-nums text-foreground truncate">
                {cell.value}
              </p>
            </div>
          ))}
        </div>

        <div className="hidden md:block h-6 w-px bg-border" aria-hidden="true" />

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {countCells.map((cell) => (
            <div key={cell.label}>
              <p className="text-[11px] text-muted-foreground">{cell.label}</p>
              <p className="text-sm font-semibold tabular-nums text-foreground">{cell.value}</p>
            </div>
          ))}
        </div>

        <SectionLink to="/desk">Full treasury →</SectionLink>
      </div>

      {unhealthy ? (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {unhealthy === "critical"
            ? "Registry writes are suspended until the treasury is back above the safety buffer."
            : "Gas runway is below the safety buffer. Registry writes pause if this stays low."}
        </p>
      ) : null}
    </section>
  );
}
