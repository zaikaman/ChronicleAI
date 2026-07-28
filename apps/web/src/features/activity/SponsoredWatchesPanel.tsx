// Active sponsored watch campaigns on the public Activity trail (Loop 4)

import type React from "react";
import { Link } from "react-router-dom";
import { StatusBadge, TimestampDisplay } from "../../components/data-primitives.tsx";
import { Surface } from "../../components/page-chrome.tsx";
import { EmptyState } from "../../components/state-views.tsx";
import { sepoliaTxUrl, truncateHash } from "../../lib/explorer.ts";

export interface ActivitySponsoredWatch {
  id: string;
  targetContract: string;
  watchSpecHash?: string;
  startsAt: string;
  endsAt: string;
  status: string;
  createTxHash?: string;
  reportTxHash?: string;
  createExplorerUrl?: string;
  reportExplorerUrl?: string;
  sourceEventRoot?: string;
  monitoredEventCount?: number;
  onChainWatchId?: number;
  auditTrail?: {
    createTxHash?: string | null;
    reportTxHash?: string | null;
    createExplorerUrl?: string | null;
    reportExplorerUrl?: string | null;
    sourceEventRoot?: string | null;
  };
}

interface SponsoredWatchesPanelProps {
  watches: ActivitySponsoredWatch[];
  "data-testid"?: string;
}

function statusVariant(
  status: string,
): "default" | "success" | "warning" | "error" | "info" {
  switch (status) {
    case "accepted":
      return "info";
    case "monitoring":
      return "warning";
    case "completed":
      return "success";
    case "failed":
      return "error";
    default:
      return "default";
  }
}

function Tx({
  hash,
  explorerUrl,
  label,
}: {
  hash?: string | null;
  explorerUrl?: string | null;
  label: string;
}): React.ReactElement {
  if (!hash) {
    return (
      <span className="text-xs text-muted-foreground">
        {label}: pending
      </span>
    );
  }
  // createSponsoredWatch / publishSponsoredReport are registry writes on Ethereum Sepolia.
  const href = explorerUrl ?? sepoliaTxUrl(hash);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
      title={hash}
    >
      {label}: {truncateHash(hash)}
    </a>
  );
}

export function SponsoredWatchesPanel({
  watches,
  "data-testid": dataTestId = "activity-sponsored-watches",
}: SponsoredWatchesPanelProps): React.ReactElement {
  if (watches.length === 0) {
    return (
      <EmptyState
        title="No active sponsored watches"
        description="Paid monitoring campaigns appear here with create and report transaction hashes."
        data-testid={`${dataTestId}-empty`}
      />
    );
  }

  return (
    <div data-testid={dataTestId} className="flex flex-col gap-3">
      {watches.map((watch) => {
        const createTx = watch.auditTrail?.createTxHash ?? watch.createTxHash;
        const reportTx = watch.auditTrail?.reportTxHash ?? watch.reportTxHash;
        const createExplorer = watch.auditTrail?.createExplorerUrl ?? watch.createExplorerUrl;
        const reportExplorer = watch.auditTrail?.reportExplorerUrl ?? watch.reportExplorerUrl;
        const dual = Boolean(createTx && reportTx);

        return (
          <Surface
            key={watch.id}
            className="p-4"
            data-testid={`activity-watch-${watch.id}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
              <div className="min-w-0">
                <Link
                  to={`/premium/watches/${watch.id}`}
                  className="font-mono text-sm text-foreground hover:text-muted-foreground transition-colors break-all"
                >
                  {watch.targetContract}
                </Link>
                <p className="text-xs text-muted-foreground mt-1">
                  <TimestampDisplay timestamp={watch.startsAt} />
                  {" → "}
                  <TimestampDisplay timestamp={watch.endsAt} />
                  {typeof watch.monitoredEventCount === "number" ? (
                    <> · {watch.monitoredEventCount} event(s)</>
                  ) : null}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge label={watch.status} variant={statusVariant(watch.status)} />
                {dual ? <StatusBadge label="Dual trail" variant="success" /> : null}
              </div>
            </div>
            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 mt-2">
              <Tx
                hash={createTx ?? null}
                explorerUrl={createExplorer ?? null}
                label="Create"
              />
              <Tx
                hash={reportTx ?? null}
                explorerUrl={reportExplorer ?? null}
                label="Report"
              />
            </div>
          </Surface>
        );
      })}
    </div>
  );
}
