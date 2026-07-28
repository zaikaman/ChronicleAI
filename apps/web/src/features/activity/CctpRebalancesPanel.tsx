// CCTP rebalance lifecycle cards — Base burn → Sepolia mint with dual explorers

import type React from "react";
import { StatusBadge, TimestampDisplay } from "../../components/data-primitives.tsx";
import { truncateHash } from "../../lib/explorer.ts";

export interface CctpRebalanceEntry {
  id: string;
  status: string;
  amountUsdc: number;
  mode: string;
  burnTxHash?: string | null;
  mintTxHash?: string | null;
  burnExplorerUrl?: string | null;
  mintExplorerUrl?: string | null;
  errorMessage?: string | null;
  burnedAt?: string | null;
  mintedAt?: string | null;
  createdAt: string;
  durationMs?: number | null;
}

interface CctpRebalancesPanelProps {
  transfers: CctpRebalanceEntry[];
  isLoading?: boolean;
  "data-testid"?: string;
}

function statusVariant(
  status: string,
): "default" | "success" | "warning" | "error" | "info" {
  switch (status) {
    case "minted":
      return "success";
    case "failed":
      return "error";
    case "stuck":
    case "awaiting_attestation":
    case "minting":
      return "warning";
    case "pending":
    case "approving":
    case "burning":
      return "info";
    default:
      return "default";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "awaiting_attestation":
      return "Awaiting attestation";
    case "minted":
      return "Minted";
    case "failed":
      return "Failed";
    case "stuck":
      return "Stuck";
    case "minting":
      return "Minting";
    case "burning":
      return "Burning";
    case "approving":
      return "Approving";
    case "pending":
      return "Pending";
    default:
      return status;
  }
}

function formatDuration(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
}

function formatUsdc(amount: number): string {
  return `${amount.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  })} USDC`;
}

export function CctpRebalancesPanel({
  transfers,
  isLoading = false,
  "data-testid": dataTestId = "cctp-rebalances-panel",
}: CctpRebalancesPanelProps): React.ReactElement {
  if (isLoading) {
    return (
      <div
        className="rounded-2xl border border-border bg-frame p-5"
        data-testid={dataTestId}
        role="status"
        aria-busy="true"
        aria-label="Loading CCTP rebalances"
      >
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="skeleton-bone h-3.5 flex-1" />
              <div className="skeleton-bone h-3.5 w-20" />
              <div className="skeleton-bone skeleton-bone--pill h-5 w-14" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (transfers.length === 0) {
    return (
      <div
        className="rounded-2xl border border-border bg-frame p-6 text-center"
        data-testid={dataTestId}
      >
        <p className="text-sm text-muted-foreground">
          No CCTP rebalances yet. Premium revenue on Base is batched into Sepolia USDC when
          policy allows.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid={dataTestId}>
      {transfers.map((tx) => {
        const duration = formatDuration(tx.durationMs);
        return (
          <article
            key={tx.id}
            className="rounded-2xl border border-border bg-frame p-4 sm:p-5"
            data-testid="cctp-rebalance-card"
          >
            <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
              <div>
                <p className="text-base font-semibold tabular-nums text-foreground m-0">
                  {formatUsdc(tx.amountUsdc)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Base Sepolia → Ethereum Sepolia · {tx.mode}
                </p>
              </div>
              <StatusBadge label={statusLabel(tx.status)} variant={statusVariant(tx.status)} />
            </div>

            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div>
                <dt className="text-muted-foreground mb-0.5">Burn (Base)</dt>
                <dd className="m-0">
                  {tx.burnTxHash ? (
                    <a
                      href={tx.burnExplorerUrl ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-muted-foreground hover:text-foreground transition-colors break-all"
                      title={tx.burnTxHash}
                    >
                      {truncateHash(tx.burnTxHash)}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground mb-0.5">Mint (Sepolia)</dt>
                <dd className="m-0">
                  {tx.mintTxHash ? (
                    <a
                      href={tx.mintExplorerUrl ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-muted-foreground hover:text-foreground transition-colors break-all"
                      title={tx.mintTxHash}
                    >
                      {truncateHash(tx.mintTxHash)}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </dd>
              </div>
            </dl>

            <div className="mt-3 pt-3 border-t border-border/50 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <TimestampDisplay timestamp={tx.createdAt} />
              {duration ? <span>Duration {duration}</span> : null}
              {tx.errorMessage ? (
                <span className="text-[var(--accent-error)] line-clamp-2" title={tx.errorMessage}>
                  {tx.errorMessage}
                </span>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
