import type { ReactElement } from "react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { EmptyState, LoadingState, RetryState } from "../../components/state-views.tsx";
import { StatusBadge, TimestampDisplay } from "../../components/data-primitives.tsx";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

interface WatchDetail {
  id: string;
  targetContract: string;
  watchSpecHash: string;
  startsAt: string;
  endsAt: string;
  status: string;
  createTxHash?: string;
  reportTxHash?: string;
  reportContentHash?: string;
  contentUri?: string;
  createExplorerUrl?: string;
  reportExplorerUrl?: string;
}

type WatchState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; error: string }
  | { status: "success"; data: WatchDetail };

/**
 * Public sponsored-watch page used as the HTTPS content URI for
 * on-chain publishSponsoredReport proofs.
 */
export function SponsoredWatchDetailPage(): ReactElement {
  const { watchId } = useParams<{ watchId: string }>();
  const [state, setState] = useState<WatchState>({ status: "loading" });

  const fetchWatch = useCallback(async () => {
    if (!watchId) {
      setState({ status: "not-found" });
      return;
    }

    setState({ status: "loading" });
    try {
      const response = await fetch(`${API_BASE}/premium/watches/${encodeURIComponent(watchId)}`);
      if (response.status === 404) {
        setState({ status: "not-found" });
        return;
      }
      if (!response.ok) {
        setState({ status: "error", error: `Failed to fetch watch (${response.status})` });
        return;
      }
      const data = (await response.json()) as WatchDetail;
      setState({ status: "success", data });
    } catch (error) {
      setState({
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error fetching watch",
      });
    }
  }, [watchId]);

  useEffect(() => {
    void fetchWatch();
  }, [fetchWatch]);

  if (state.status === "loading") {
    return <LoadingState message="Loading sponsored watch..." data-testid="watch-detail-loading" />;
  }

  if (state.status === "not-found") {
    return (
      <div className="max-w-4xl mx-auto">
        <EmptyState
          title="Sponsored watch not found"
          description="This monitoring campaign is not available or the content URI is invalid."
          data-testid="watch-detail-not-found"
        />
        <div className="mt-4 text-center">
          <Link to="/premium" className="text-accent hover:underline text-sm font-medium">
            Back to premium
          </Link>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="max-w-4xl mx-auto">
        <RetryState
          title="Failed to load sponsored watch"
          message={state.error}
          onRetry={fetchWatch}
          data-testid="watch-detail-error"
        />
      </div>
    );
  }

  const watch = state.data;

  return (
    <div data-testid="watch-detail" className="max-w-4xl mx-auto space-y-6">
      <div>
        <Link to="/premium" className="text-accent hover:underline text-sm font-medium">
          ← Premium
        </Link>
        <h1
          className="text-3xl font-bold tracking-tight text-foreground mt-3 mb-2"
          style={{ fontFamily: "var(--font-space-grotesk)" }}
        >
          Sponsored Watch Report
        </h1>
        <StatusBadge label={watch.status} variant="info" />
      </div>

      <dl className="grid gap-4 sm:grid-cols-2 rounded-xl border border-border bg-muted/20 p-5 text-sm">
        <div>
          <dt className="text-muted-foreground font-medium mb-1">Target contract</dt>
          <dd className="font-mono break-all text-foreground">{watch.targetContract}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground font-medium mb-1">Watch spec hash</dt>
          <dd className="font-mono break-all text-foreground">{watch.watchSpecHash}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground font-medium mb-1">Starts</dt>
          <dd>
            <TimestampDisplay timestamp={watch.startsAt} />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground font-medium mb-1">Ends</dt>
          <dd>
            <TimestampDisplay timestamp={watch.endsAt} />
          </dd>
        </div>
        {watch.reportContentHash && (
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground font-medium mb-1">Report content hash</dt>
            <dd className="font-mono break-all text-foreground">{watch.reportContentHash}</dd>
          </div>
        )}
        {watch.createTxHash && (
          <div>
            <dt className="text-muted-foreground font-medium mb-1">Create tx</dt>
            <dd className="font-mono break-all">
              {watch.createExplorerUrl ? (
                <a
                  href={watch.createExplorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  {watch.createTxHash}
                </a>
              ) : (
                watch.createTxHash
              )}
            </dd>
          </div>
        )}
        {watch.reportTxHash && (
          <div>
            <dt className="text-muted-foreground font-medium mb-1">Report tx</dt>
            <dd className="font-mono break-all">
              {watch.reportExplorerUrl ? (
                <a
                  href={watch.reportExplorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  {watch.reportTxHash}
                </a>
              ) : (
                watch.reportTxHash
              )}
            </dd>
          </div>
        )}
      </dl>

      {watch.contentUri && (
        <div className="text-center">
          <span className="inline-flex items-center gap-2 px-4 py-2.5 bg-muted/30 border border-border text-muted-foreground rounded-xl text-sm font-mono break-all">
            {watch.contentUri}
          </span>
        </div>
      )}
    </div>
  );
}
