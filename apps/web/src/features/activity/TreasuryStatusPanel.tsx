// Treasury status panel — dual-rail capital plane
// Gas (ETH Sepolia) drives healthy/warning/critical.
// Base USDC = x402 payment pocket; Sepolia USDC = deployable desk float.
// CCTP rebalances Base → Sepolia; capital manager never spends Base USDC.

import type React from "react";
import { baseSepoliaAddressUrl, sepoliaAddressUrl, truncateHash } from "../../lib/explorer.ts";

export interface TreasuryStatusData {
  availableBalance: number;
  safetyBuffer: number;
  /** Unit of availableBalance / safetyBuffer (ETH for gas health). */
  currency?: string;
  status: string;
  ethBalance?: number;
  usdcBalance?: number;
  walletAddress?: string;
  /** Base Sepolia USDC (payment rail). */
  baseUsdcBalance?: number;
  /** Ethereum Sepolia USDC (ops / desk rail). */
  sepoliaUsdcBalance?: number;
  baseEthBalance?: number;
  sepoliaEthBalance?: number;
  inFlightCctpUsdc?: number;
  deployableToDeskUsdc?: number;
  usdcOperatingReserve?: number;
  cctpEnabled?: boolean;
  capitalPlaneNote?: string;
  estimatedGenerationCost?: number | null;
  estimatedTransactionCost?: number | null;
  paidRequestCount?: number | null;
  revenueTotal?: number | null;
}

interface TreasuryStatusPanelProps {
  treasury: TreasuryStatusData | null;
  isLoading?: boolean;
  "data-testid"?: string;
}

function getStatusConfig(status: string): {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  icon: string;
} {
  switch (status) {
    case "healthy":
      return {
        label: "Gas healthy",
        color: "var(--accent-success)",
        bgColor: "rgba(34, 197, 94, 0.1)",
        borderColor: "rgba(34, 197, 94, 0.2)",
        icon: "\u2713",
      };
    case "warning":
      return {
        label: "Gas low",
        color: "var(--accent-warning)",
        bgColor: "rgba(245, 158, 11, 0.1)",
        borderColor: "rgba(245, 158, 11, 0.2)",
        icon: "\u26A0",
      };
    case "critical":
      return {
        label: "Gas critical",
        color: "var(--accent-error)",
        bgColor: "rgba(239, 68, 68, 0.1)",
        borderColor: "rgba(239, 68, 68, 0.2)",
        icon: "\u2716",
      };
    default:
      return {
        label: "Unknown",
        color: "var(--fg-tertiary)",
        bgColor: "var(--bg-glass)",
        borderColor: "var(--border-primary)",
        icon: "?",
      };
  }
}

/**
 * Format crypto / stable amounts with adaptive precision.
 * ETH gas is often fractional (0.025); USDC typically whole or 2dp.
 */
function formatAssetAmount(amount: number, currency: string): string {
  const code = (currency || "ETH").toUpperCase();
  const abs = Math.abs(amount);

  let maxFractionDigits = 6;
  if (code === "USDC" || code === "USDT" || code === "DAI" || code === "EURC") {
    maxFractionDigits = abs >= 1 || abs === 0 ? 2 : 4;
  } else if (abs >= 1000) {
    maxFractionDigits = 2;
  } else if (abs >= 1) {
    maxFractionDigits = 4;
  } else if (abs === 0) {
    maxFractionDigits = 0;
  }

  const formatted = amount.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  });
  return `${formatted} ${code}`;
}

export function TreasuryStatusPanel({
  treasury,
  isLoading = false,
  "data-testid": dataTestId = "treasury-status-panel",
}: TreasuryStatusPanelProps): React.ReactElement {
  if (isLoading) {
    return (
      <div
        className="rounded-2xl border border-border bg-frame p-5"
        data-testid={dataTestId}
        role="status"
        aria-busy="true"
        aria-label="Loading treasury status"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="rounded-xl border border-border/60 bg-muted/40 p-3">
              <div className="skeleton-bone h-3 w-20 mb-2" />
              <div className="skeleton-bone h-6 w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!treasury) {
    return (
      <div
        className="rounded-2xl border border-border bg-frame p-6 text-center"
        data-testid={dataTestId}
      >
        <p className="text-sm text-muted-foreground">No treasury data available.</p>
      </div>
    );
  }

  const statusConfig = getStatusConfig(treasury.status);
  const ethBalance =
    typeof treasury.ethBalance === "number" ? treasury.ethBalance : treasury.availableBalance;
  const safetyBuffer = treasury.safetyBuffer;
  const sepoliaUsdc =
    typeof treasury.sepoliaUsdcBalance === "number"
      ? treasury.sepoliaUsdcBalance
      : typeof treasury.usdcBalance === "number"
        ? treasury.usdcBalance
        : undefined;
  const baseUsdc =
    typeof treasury.baseUsdcBalance === "number" ? treasury.baseUsdcBalance : undefined;
  const inFlight =
    typeof treasury.inFlightCctpUsdc === "number" ? treasury.inFlightCctpUsdc : undefined;
  const deployable =
    typeof treasury.deployableToDeskUsdc === "number"
      ? treasury.deployableToDeskUsdc
      : sepoliaUsdc !== undefined && typeof treasury.usdcOperatingReserve === "number"
        ? Math.max(0, sepoliaUsdc - treasury.usdcOperatingReserve)
        : undefined;
  const dualRail = baseUsdc !== undefined || sepoliaUsdc !== undefined;
  const bufferRatio = safetyBuffer > 0 ? (ethBalance / safetyBuffer) * 100 : 0;

  return (
    <div
      data-testid={dataTestId}
      className="rounded-2xl border p-5 sm:p-6"
      style={{
        background: statusConfig.bgColor,
        borderColor: statusConfig.borderColor,
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-foreground m-0">Agent treasury</h3>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed max-w-xl">
            {dualRail
              ? "Dual-rail capital: Base USDC from x402 payments; Sepolia USDC for desk top-ups after Circle CCTP. Gas health is Sepolia ETH vs the safety buffer."
              : "Gas (ETH) powers registry writes; revenue (USDC) funds payouts. Health is based on gas runway vs the safety buffer."}
          </p>
          {treasury.walletAddress ? (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              <a
                href={sepoliaAddressUrl(treasury.walletAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                title={`Sepolia: ${treasury.walletAddress}`}
                data-testid="treasury-wallet-address"
              >
                Sepolia {truncateHash(treasury.walletAddress, 8, 6)}
              </a>
              <a
                href={baseSepoliaAddressUrl(treasury.walletAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                title={`Base: ${treasury.walletAddress}`}
                data-testid="treasury-wallet-address-base"
              >
                Base {truncateHash(treasury.walletAddress, 8, 6)}
              </a>
            </div>
          ) : null}
        </div>
        <div
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 border shrink-0"
          style={{
            background: statusConfig.bgColor,
            borderColor: statusConfig.borderColor,
          }}
        >
          <span style={{ color: statusConfig.color, fontWeight: 700 }}>{statusConfig.icon}</span>
          <span className="text-sm font-semibold" style={{ color: statusConfig.color }}>
            {statusConfig.label}
          </span>
        </div>
      </div>

      {treasury.capitalPlaneNote ? (
        <p
          className="mb-4 text-xs text-muted-foreground leading-relaxed rounded-xl border border-border/60 bg-frame/60 px-3 py-2"
          data-testid="treasury-capital-plane-note"
        >
          {treasury.capitalPlaneNote}
        </p>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <AssetCard
          label="Gas reserve (Sepolia)"
          amount={formatAssetAmount(ethBalance, "ETH")}
          hint={
            safetyBuffer > 0
              ? `Min buffer ${formatAssetAmount(safetyBuffer, "ETH")}`
              : "Native ETH for KeeperHub writes"
          }
          testId="treasury-eth-balance"
        />
        <AssetCard
          label="Deployable to desk"
          amount={
            deployable !== undefined
              ? formatAssetAmount(deployable, "USDC")
              : sepoliaUsdc !== undefined
                ? formatAssetAmount(sepoliaUsdc, "USDC")
                : "Unavailable"
          }
          hint={
            typeof treasury.usdcOperatingReserve === "number"
              ? `Sepolia USDC minus ${formatAssetAmount(treasury.usdcOperatingReserve, "USDC")} reserve`
              : "Sepolia USDC available for desk top-up"
          }
          testId="treasury-deployable-usdc"
          muted={deployable === undefined && sepoliaUsdc === undefined}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
        <AssetCard
          label="Base USDC"
          amount={
            baseUsdc !== undefined ? formatAssetAmount(baseUsdc, "USDC") : "Unavailable"
          }
          hint="x402 payment rail (Base Sepolia)"
          testId="treasury-base-usdc"
          muted={baseUsdc === undefined}
        />
        <AssetCard
          label="Sepolia USDC"
          amount={
            sepoliaUsdc !== undefined ? formatAssetAmount(sepoliaUsdc, "USDC") : "Unavailable"
          }
          hint="Ops / desk rail after CCTP mint"
          testId="treasury-sepolia-usdc"
          muted={sepoliaUsdc === undefined}
        />
        <AssetCard
          label="CCTP in-flight"
          amount={
            inFlight !== undefined ? formatAssetAmount(inFlight, "USDC") : "—"
          }
          hint={
            treasury.cctpEnabled === false
              ? "CCTP rebalance disabled"
              : "Burned on Base, not yet minted on Sepolia"
          }
          testId="treasury-cctp-inflight"
          muted={inFlight === undefined || inFlight === 0}
        />
      </div>

      <div>
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span>Gas vs safety buffer</span>
          <span className="tabular-nums">{bufferRatio.toFixed(0)}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden" role="presentation" aria-hidden>
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{
              width: `${Math.min(Math.max(bufferRatio, 0), 100)}%`,
              background:
                treasury.status === "healthy"
                  ? "var(--accent-success)"
                  : treasury.status === "warning"
                    ? "var(--accent-warning)"
                    : "var(--accent-error)",
            }}
          />
        </div>
      </div>

      {(treasury.estimatedGenerationCost != null ||
        treasury.estimatedTransactionCost != null ||
        treasury.revenueTotal != null) && (
        <div
          className="mt-4 pt-4 border-t border-border/50 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs"
          data-testid="treasury-utility-metrics"
        >
          {treasury.revenueTotal != null ? (
            <div>
              <p className="text-muted-foreground mb-0.5">Settled revenue</p>
              <p className="font-semibold tabular-nums text-foreground">
                {formatAssetAmount(treasury.revenueTotal, "USDC")}
              </p>
            </div>
          ) : null}
          {treasury.estimatedGenerationCost != null ? (
            <div>
              <p className="text-muted-foreground mb-0.5">Est. generation cost</p>
              <p className="font-semibold tabular-nums text-foreground">
                {formatAssetAmount(treasury.estimatedGenerationCost, "USDC")}
              </p>
            </div>
          ) : null}
          {treasury.estimatedTransactionCost != null ? (
            <div>
              <p className="text-muted-foreground mb-0.5">Est. write cost</p>
              <p className="font-semibold tabular-nums text-foreground">
                {formatAssetAmount(treasury.estimatedTransactionCost, "USDC")}
              </p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function AssetCard({
  label,
  amount,
  hint,
  testId,
  muted = false,
}: {
  label: string;
  amount: string;
  hint: string;
  testId: string;
  muted?: boolean;
}): React.ReactElement {
  return (
    <div
      className="rounded-xl border border-border/60 bg-frame/60 px-4 py-3"
      data-testid={testId}
    >
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
      <p
        className={`text-xl font-semibold tabular-nums tracking-tight ${
          muted ? "text-muted-foreground" : "text-foreground"
        }`}
      >
        {amount}
      </p>
      <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{hint}</p>
    </div>
  );
}
