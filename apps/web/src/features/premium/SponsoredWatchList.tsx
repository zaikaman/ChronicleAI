// Sponsored watch list component
// Displays active sponsored campaigns and their transaction hashes

import type React from "react";
import { StatusBadge, TimestampDisplay } from "../../components/data-primitives.tsx";

export interface SponsoredWatchModel {
  id: string;
  targetContract: string;
  status: string;
  createTxHash?: string;
  reportTxHash?: string;
  startsAt: string;
  endsAt: string;
}

interface SponsoredWatchListProps {
  watches: SponsoredWatchModel[];
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

export function SponsoredWatchList({
  watches,
  isLoading = false,
  "data-testid": dataTestId = "sponsored-watch-list",
}: SponsoredWatchListProps): React.ReactElement {
  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: "2rem" }}>
        <p style={{ color: "var(--fg-tertiary)", fontSize: "var(--font-size-sm)" }}>
          Loading sponsored watches...
        </p>
      </div>
    );
  }

  if (watches.length === 0) {
    return (
      <div
        style={{
          padding: "1.5rem",
          textAlign: "center",
          background: "var(--bg-glass)",
          borderRadius: "8px",
          border: "1px solid var(--border-primary)",
        }}
      >
        <p style={{ color: "var(--fg-tertiary)", margin: 0, fontSize: "var(--font-size-sm)" }}>
          No active sponsored monitoring campaigns.
        </p>
      </div>
    );
  }

  return (
    <div data-testid={dataTestId}>
      <h3
        style={{
          fontSize: "var(--font-size-md)",
          fontWeight: 600,
          color: "var(--fg-primary)",
          marginBottom: "1rem",
        }}
      >
        Sponsored Campaigns
      </h3>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {watches.map((watch) => (
          <div
            key={watch.id}
            className="card"
            style={{ padding: "1rem" }}
            data-testid={`watch-${watch.id}`}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: "0.75rem",
                gap: "0.75rem",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "var(--font-size-xs)",
                    fontFamily: "var(--font-mono)",
                    color: "var(--fg-secondary)",
                    marginBottom: "0.25rem",
                  }}
                >
                  {watch.targetContract.slice(0, 10)}...{watch.targetContract.slice(-6)}
                </div>
              </div>
              <StatusBadge label={watch.status} variant={getWatchStatusVariant(watch.status)} />
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "1rem",
                fontSize: "var(--font-size-xs)",
                color: "var(--fg-tertiary)",
              }}
            >
              <div>
                <span>Start: </span>
                <TimestampDisplay timestamp={watch.startsAt} />
              </div>
              <div>
                <span>End: </span>
                <TimestampDisplay timestamp={watch.endsAt} />
              </div>
            </div>

            {watch.createTxHash && (
              <div
                style={{
                  marginTop: "0.5rem",
                  fontSize: "var(--font-size-xs)",
                  color: "var(--fg-tertiary)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                Create Tx: {watch.createTxHash.slice(0, 16)}...
              </div>
            )}

            {watch.reportTxHash && (
              <div
                style={{
                  marginTop: "0.25rem",
                  fontSize: "var(--font-size-xs)",
                  color: "var(--fg-tertiary)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                Report Tx: {watch.reportTxHash.slice(0, 16)}...
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
