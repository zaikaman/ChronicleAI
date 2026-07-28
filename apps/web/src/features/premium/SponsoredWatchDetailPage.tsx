import type { ReactElement } from "react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { StatusBadge, TimestampDisplay } from "../../components/data-primitives.tsx";
import {
  ContentUriFooter,
  Page,
  PageBackLink,
  PageHeader,
  PageSection,
  Surface,
} from "../../components/page-chrome.tsx";
import { EmptyState, LoadingState, RetryState } from "../../components/state-views.tsx";

import { API_BASE } from "../../lib/api.ts";

interface WatchAuditTrail {
  createTxHash: string | null;
  createExplorerUrl: string | null;
  reportTxHash: string | null;
  reportExplorerUrl: string | null;
  sourceEventRoot: string | null;
  reportContentHash: string | null;
}

interface WatchDetail {
  id: string;
  targetContract: string;
  watchSpecHash: string;
  startsAt: string;
  endsAt: string;
  status: string;
  onChainWatchId?: number;
  createTxHash?: string;
  reportTxHash?: string;
  reportContentHash?: string;
  sourceEventRoot?: string;
  sourceEventIds?: string[];
  contentUri?: string;
  createExplorerUrl?: string;
  reportExplorerUrl?: string;
  createKeeperHubRunId?: string;
  reportKeeperHubRunId?: string;
  reportTitle?: string;
  reportSummary?: string;
  reportHighlights?: string[];
  reportAnalysis?: string;
  monitoredEventCount?: number;
  lastMonitoredAt?: string;
  auditTrail?: WatchAuditTrail;
}

type WatchState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; error: string }
  | { status: "success"; data: WatchDetail };

function TxLink({
  hash,
  explorerUrl,
  label,
}: {
  hash?: string | null;
  explorerUrl?: string | null;
  label: string;
}): ReactElement | null {
  if (!hash) {
    return (
      <div>
        <dt className="text-xs text-muted-foreground font-medium mb-1">{label}</dt>
        <dd className="text-muted-foreground text-sm">Pending</dd>
      </div>
    );
  }

  return (
    <div>
      <dt className="text-xs text-muted-foreground font-medium mb-1">{label}</dt>
      <dd className="font-mono break-all text-sm">
        {explorerUrl ? (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground hover:text-muted-foreground transition-colors"
          >
            {hash}
          </a>
        ) : (
          <span className="text-foreground">{hash}</span>
        )}
      </dd>
    </div>
  );
}

/**
 * Public sponsored-watch page used as the HTTPS content URI for
 * on-chain publishSponsoredReport proofs.
 *
 * Shows the dual on-chain audit trail: createSponsoredWatch tx +
 * publishSponsoredReport tx with sourceEventRoot.
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
    return (
      <Page data-testid="watch-detail">
        <LoadingState
          message="Loading sponsored watch..."
          variant="detail"
          data-testid="watch-detail-loading"
        />
      </Page>
    );
  }

  if (state.status === "not-found") {
    return (
      <Page data-testid="watch-detail">
        <PageBackLink to="/premium">Premium</PageBackLink>
        <EmptyState
          title="Sponsored watch not found"
          description="This monitoring campaign is not available or the content URI is invalid."
          data-testid="watch-detail-not-found"
        />
        <div className="mt-4 text-center">
          <Link
            to="/premium"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Back to premium
          </Link>
        </div>
      </Page>
    );
  }

  if (state.status === "error") {
    return (
      <Page data-testid="watch-detail">
        <PageBackLink to="/premium">Premium</PageBackLink>
        <RetryState
          title="Failed to load sponsored watch"
          message={state.error}
          onRetry={fetchWatch}
          data-testid="watch-detail-error"
        />
      </Page>
    );
  }

  const watch = state.data;
  const createTx = watch.auditTrail?.createTxHash ?? watch.createTxHash;
  const createExplorer = watch.auditTrail?.createExplorerUrl ?? watch.createExplorerUrl;
  const reportTx = watch.auditTrail?.reportTxHash ?? watch.reportTxHash;
  const reportExplorer = watch.auditTrail?.reportExplorerUrl ?? watch.reportExplorerUrl;
  const sourceEventRoot = watch.auditTrail?.sourceEventRoot ?? watch.sourceEventRoot;
  const reportContentHash = watch.auditTrail?.reportContentHash ?? watch.reportContentHash;
  const dualTrailComplete = Boolean(createTx && reportTx);

  return (
    <Page data-testid="watch-detail">
      <PageBackLink to="/premium">Premium</PageBackLink>
      <PageHeader
        title={watch.reportTitle ?? "Sponsored Watch Report"}
        below={
          <>
            <StatusBadge label={watch.status} variant="info" />
            {dualTrailComplete ? (
              <StatusBadge label="Dual audit trail" variant="success" />
            ) : (
              <StatusBadge label="Campaign in progress" variant="warning" />
            )}
          </>
        }
      />

      <Surface className="p-5 mb-8">
        <dl className="grid gap-4 sm:grid-cols-2 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground font-medium mb-1">Target contract</dt>
            <dd className="font-mono break-all text-foreground">{watch.targetContract}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground font-medium mb-1">Watch spec hash</dt>
            <dd className="font-mono break-all text-foreground">{watch.watchSpecHash}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground font-medium mb-1">Starts</dt>
            <dd>
              <TimestampDisplay timestamp={watch.startsAt} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground font-medium mb-1">Ends</dt>
            <dd>
              <TimestampDisplay timestamp={watch.endsAt} />
            </dd>
          </div>
          {watch.onChainWatchId != null ? (
            <div>
              <dt className="text-xs text-muted-foreground font-medium mb-1">On-chain watch id</dt>
              <dd className="font-mono text-foreground">{watch.onChainWatchId}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs text-muted-foreground font-medium mb-1">Events matched</dt>
            <dd className="text-foreground">{watch.monitoredEventCount ?? 0}</dd>
          </div>
        </dl>
      </Surface>

      <PageSection
        title="On-chain audit trail"
        description="Paid campaigns record both acceptance (createSponsoredWatch) and final report publication (publishSponsoredReport with source-event root)."
        data-testid="watch-audit-trail"
      >
        <Surface className="p-5">
          <dl className="grid gap-4 sm:grid-cols-2 text-sm">
            <TxLink
              {...(createTx !== undefined ? { hash: createTx } : {})}
              {...(createExplorer !== undefined
                ? { explorerUrl: createExplorer }
                : {})}
              label="Create tx (createSponsoredWatch)"
            />
            <TxLink
              {...(reportTx !== undefined ? { hash: reportTx } : {})}
              {...(reportExplorer !== undefined
                ? { explorerUrl: reportExplorer }
                : {})}
              label="Report tx (publishSponsoredReport)"
            />
            {reportContentHash ? (
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground font-medium mb-1">
                  Report content hash
                </dt>
                <dd className="font-mono break-all text-foreground">{reportContentHash}</dd>
              </div>
            ) : null}
            {sourceEventRoot ? (
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground font-medium mb-1">
                  Source event root
                </dt>
                <dd
                  className="font-mono break-all text-foreground"
                  data-testid="watch-source-event-root"
                >
                  {sourceEventRoot}
                </dd>
              </div>
            ) : null}
            {watch.createKeeperHubRunId ? (
              <div>
                <dt className="text-xs text-muted-foreground font-medium mb-1">
                  Create KeeperHub run
                </dt>
                <dd className="font-mono break-all text-foreground">
                  {watch.createKeeperHubRunId}
                </dd>
              </div>
            ) : null}
            {watch.reportKeeperHubRunId ? (
              <div>
                <dt className="text-xs text-muted-foreground font-medium mb-1">
                  Report KeeperHub run
                </dt>
                <dd className="font-mono break-all text-foreground">
                  {watch.reportKeeperHubRunId}
                </dd>
              </div>
            ) : null}
          </dl>
        </Surface>
      </PageSection>

      {(watch.reportSummary ||
        (watch.reportHighlights && watch.reportHighlights.length > 0)) && (
        <PageSection title="Campaign report" data-testid="watch-report-body">
          <Surface className="p-5 space-y-4">
            {watch.reportSummary ? (
              <p className="text-sm text-foreground leading-relaxed">{watch.reportSummary}</p>
            ) : null}
            {watch.reportHighlights && watch.reportHighlights.length > 0 ? (
              <ul className="list-disc pl-5 space-y-1 text-sm text-foreground">
                {watch.reportHighlights.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
            {watch.reportAnalysis ? (
              <div className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {watch.reportAnalysis}
              </div>
            ) : null}
          </Surface>
        </PageSection>
      )}

      {watch.contentUri ? <ContentUriFooter uri={watch.contentUri} /> : null}
    </Page>
  );
}
