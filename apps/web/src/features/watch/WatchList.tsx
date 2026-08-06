// Watch list — active monitoring campaigns and their transaction hashes.

import type React from "react";
import { Link } from "react-router-dom";
import { StatusBadge, TimestampDisplay } from "../../components/data-primitives.tsx";
import { EmptyState } from "../../components/state-views.tsx";
import { Surface } from "../../components/page-chrome.tsx";
import { SkeletonPanel } from "../../components/ui/skeleton.tsx";

export interface WatchModel {
  id: string;
  targetContract: string;
  status: string;
  createTxHash?: string;
  reportTxHash?: string;
  createExplorerUrl?: string;
  reportExplorerUrl?: string;
  sourceEventRoot?: string;
  startsAt: string;
  endsAt: string;
  targetKind?: "contract" | "wallet";
  visibility?: "public" | "private";
}

interface WatchListProps {
  watches: WatchModel[];
  isLoading?: boolean;
  "data-testid"?: string;
}

function getWatchStatusVariant(
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

export function WatchList({
  watches,
  isLoading = false,
  "data-testid": dataTestId = "sponsored-watch-list",
}: WatchListProps): React.ReactElement {
  if (isLoading) {
    return (
      <SkeletonPanel rows={3} data-testid={`${dataTestId}-loading`} />
    );
  }

  if (watches.length === 0) {
    return (
      <EmptyState
        title="No active campaigns"
        description="No active monitoring campaigns yet. Request a watch above to open one."
        data-testid={`${dataTestId}-empty`}
      />
    );
  }

  return (
    <div data-testid={dataTestId} className="flex flex-col gap-3">
      {watches.map((watch) => (
        <Surface key={watch.id} className="p-4" data-testid={`watch-${watch.id}`}>
          <div className="flex justify-between items-start mb-3 gap-3">
            <div className="min-w-0">
              <Link
                to={`/watch/${watch.id}`}
                className="font-mono text-xs text-foreground hover:text-muted-foreground transition-colors break-all"
              >
                {watch.targetContract.slice(0, 10)}…{watch.targetContract.slice(-6)}
              </Link>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {watch.targetKind === "wallet" ? (
                  <StatusBadge label="Wallet" variant="info" />
                ) : (
                  <StatusBadge label="Contract" variant="default" />
                )}
                {watch.visibility === "private" ? (
                  <StatusBadge label="Private" variant="warning" />
                ) : (
                  <StatusBadge label="Public" variant="success" />
                )}
              </div>
            </div>
            <StatusBadge label={watch.status} variant={getWatchStatusVariant(watch.status)} />
          </div>

          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mb-2">
            <div>
              <span>Start: </span>
              <TimestampDisplay timestamp={watch.startsAt} />
            </div>
            <div>
              <span>End: </span>
              <TimestampDisplay timestamp={watch.endsAt} />
            </div>
          </div>

          {(watch.createTxHash || watch.reportTxHash) && (
            <div
              className="mt-2 flex flex-col gap-1 text-xs font-mono text-muted-foreground"
              data-testid={`watch-audit-${watch.id}`}
            >
              {watch.createTxHash && (
                <div>
                  Create Tx:{" "}
                  {watch.createExplorerUrl ? (
                    <a
                      href={watch.createExplorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-foreground transition-colors"
                    >
                      {watch.createTxHash.slice(0, 16)}…
                    </a>
                  ) : (
                    `${watch.createTxHash.slice(0, 16)}…`
                  )}
                </div>
              )}
              {watch.reportTxHash ? (
                <div>
                  Report Tx:{" "}
                  {watch.reportExplorerUrl ? (
                    <a
                      href={watch.reportExplorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-foreground transition-colors"
                    >
                      {watch.reportTxHash.slice(0, 16)}…
                    </a>
                  ) : (
                    `${watch.reportTxHash.slice(0, 16)}…`
                  )}
                </div>
              ) : (
                <div>Report Tx: pending end of campaign</div>
              )}
              {watch.sourceEventRoot && (
                <div>Source root: {watch.sourceEventRoot.slice(0, 16)}…</div>
              )}
            </div>
          )}
        </Surface>
      ))}
    </div>
  );
}
