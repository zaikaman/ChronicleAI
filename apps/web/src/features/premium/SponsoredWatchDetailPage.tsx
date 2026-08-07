import type { ReactElement } from "react";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileCheck2,
  Fingerprint,
  Layers3,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
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

import { API_BASE, fetchWithTimeout } from "../../lib/api.ts";

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
  targetKind?: "wallet" | "contract";
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
            className="inline-flex items-center gap-1.5 text-foreground hover:text-muted-foreground transition-colors"
          >
            {hash}
            <ExternalLink aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          </a>
        ) : (
          <span className="text-foreground">{hash}</span>
        )}
      </dd>
    </div>
  );
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function formatWindowDuration(startsAt: string, endsAt: string): string {
  const durationMs = new Date(endsAt).getTime() - new Date(startsAt).getTime();
  if (!Number.isFinite(durationMs) || durationMs <= 0) return "Unknown";

  const minutes = Math.max(1, Math.round(durationMs / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (Number.isInteger(hours)) return `${hours} hr`;
  return `${hours.toFixed(1)} hr`;
}

function formatTargetKind(targetKind?: "wallet" | "contract"): string {
  return targetKind === "wallet" ? "Wallet activity" : "Contract activity";
}

function splitReportBlocks(analysis?: string): Array<{ heading?: string; body: string }> {
  return (analysis ?? "")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const newline = block.indexOf("\n");
      if (newline > 0 && newline < 36) {
        return { heading: block.slice(0, newline).trim(), body: block.slice(newline + 1).trim() };
      }
      return { body: block };
    });
}

function isRepetitiveHighlightSet(highlights?: string[]): boolean {
  const lines = (highlights ?? []).map((line) =>
    line
      .replace(/^\d+\.\s*/, "")
      .replace(/tx\s+0x[0-9a-fA-F]+(?:…|\.\.\.)?/g, "tx <hash>")
      .replace(/\s*\(significance:\s*[^)]+\)/gi, "")
      .trim()
      .toLowerCase(),
  );
  return lines.length >= 4 && new Set(lines).size === 1;
}

function HighlightText({ line }: { line: string }): ReactElement {
  const separator = line.indexOf(":");
  if (separator > 0 && separator < 24) {
    return (
      <>
        <span className="font-semibold text-foreground">{line.slice(0, separator)}:</span>
        {line.slice(separator + 1)}
      </>
    );
  }
  return <>{line}</>;
}

function SignalMetric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
}): ReactElement {
  return (
    <div className="p-4 sm:p-5">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon aria-hidden="true" className="h-4 w-4 text-foreground" strokeWidth={1.8} />
        {label}
      </div>
      <p className="mt-2 text-xl font-semibold tracking-tight text-foreground tabular-nums">
        {value}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>
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

  const fetchWatch = useCallback(async (signal?: AbortSignal) => {
    if (!watchId) {
      setState({ status: "not-found" });
      return;
    }

    setState({ status: "loading" });
    try {
      const response = await fetchWithTimeout(
        `${API_BASE}/premium/watches/${encodeURIComponent(watchId)}`,
        signal ? { signal } : undefined,
      );
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
      if (signal?.aborted) return;
      setState({
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error fetching watch",
      });
    }
  }, [watchId]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchWatch(controller.signal);
    return () => controller.abort();
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
        <PageBackLink to="/watch">Watch</PageBackLink>
        <EmptyState
          title="Sponsored watch not found"
          description="This monitoring campaign is not available or the content URI is invalid."
          data-testid="watch-detail-not-found"
        />
        <div className="mt-4 text-center">
          <Link
            to="/watch"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Back to Watch
          </Link>
        </div>
      </Page>
    );
  }

  if (state.status === "error") {
    return (
      <Page data-testid="watch-detail">
        <PageBackLink to="/watch">Watch</PageBackLink>
        <RetryState
          title="Failed to load sponsored watch"
          message={state.error}
          onRetry={() => void fetchWatch()}
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
  const sourceEventCount = watch.sourceEventIds?.length ?? watch.monitoredEventCount ?? 0;
  const reportNeedsContext = isRepetitiveHighlightSet(watch.reportHighlights);
  const displaySummary = reportNeedsContext
    ? `The campaign recorded ${formatCount(watch.monitoredEventCount ?? 0)} matching event records across ${formatCount(sourceEventCount)} committed source records. The stored narrative contains abbreviated transaction references but does not include decoded asset, amount, or direction metadata.`
    : watch.reportSummary;
  const displayHighlights = reportNeedsContext
    ? [
        `Coverage: ${formatCount(watch.monitoredEventCount ?? 0)} matching event records were retained for this campaign.`,
        "Interpretation: the stored report does not support a token amount or USD-value conclusion because those fields were not decoded.",
        `Verification: the source-event root and publication transaction are the authoritative evidence for the committed source set.`,
      ]
    : watch.reportHighlights;
  const reportBlocks = reportNeedsContext
    ? [
        {
          heading: "Readout",
          body: "This report body is a legacy narrative with repeated event formatting. It confirms the size of the committed source set, but not the economic meaning of each transfer.",
        },
        {
          heading: "Evidence",
          body: "Use the source-event root and publication transaction below to verify the committed record set. New campaigns use decoded activity summaries with cadence, flow, asset, and counterparty context.",
        },
      ]
    : splitReportBlocks(watch.reportAnalysis);
  const reportVerified = Boolean(dualTrailComplete && reportContentHash && sourceEventRoot);

  return (
    <Page data-testid="watch-detail">
      <PageBackLink to="/watch">Watch</PageBackLink>
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

      <Surface className="mb-8 overflow-hidden" data-testid="watch-campaign-overview">
        <div className="border-b border-border bg-card-secondary/30 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 max-w-3xl">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground">CAMPAIGN OUTCOME</p>
              <h2
                className="mt-2 break-words text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
                style={{ overflowWrap: "anywhere" }}
              >
                {displaySummary ?? "Monitoring campaign completed."}
              </h2>
            </div>
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-accent" />
              {reportVerified ? "Source-backed report" : "Report proof pending"}
            </div>
          </div>
        </div>

        <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
          <SignalMetric
            icon={Activity}
            label="Observations"
            value={formatCount(watch.monitoredEventCount ?? 0)}
            detail="qualifying events matched"
          />
          <SignalMetric
            icon={Layers3}
            label="Source records"
            value={formatCount(sourceEventCount)}
            detail="records committed to the report"
          />
          <SignalMetric
            icon={Clock3}
            label="Watch window"
            value={formatWindowDuration(watch.startsAt, watch.endsAt)}
            detail="from start to end of monitoring"
          />
          <SignalMetric
            icon={ShieldCheck}
            label="Verification"
            value={reportVerified ? "Verified" : "Pending"}
            detail={reportVerified ? "dual receipt + source root" : "waiting for publication proof"}
          />
        </div>

        <div className="grid gap-4 border-t border-border p-5 text-sm sm:grid-cols-2 sm:p-6">
          <div className="min-w-0">
            <dt className="text-xs font-medium text-muted-foreground">Target</dt>
            <dd className="mt-1 break-all font-mono text-foreground">{watch.targetContract}</dd>
            <p className="mt-1 text-xs text-muted-foreground">{formatTargetKind(watch.targetKind)} on Ethereum Mainnet</p>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Observed window</dt>
            <dd className="mt-1 text-foreground">
              <TimestampDisplay timestamp={watch.startsAt} format="full" />
              <span className="px-1 text-muted-foreground">to</span>
              <TimestampDisplay timestamp={watch.endsAt} format="full" />
            </dd>
            {watch.onChainWatchId != null ? (
              <p className="mt-1 text-xs text-muted-foreground">On-chain watch ID {watch.onChainWatchId}</p>
            ) : null}
          </div>
        </div>
      </Surface>

      <PageSection
        title="On-chain audit trail"
        description="Paid campaigns record both acceptance (createSponsoredWatch) and final report publication (publishSponsoredReport with source-event root)."
        data-testid="watch-audit-trail"
      >
        <Surface className="overflow-hidden">
          <div className="grid divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
            <div className="p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
                  <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-muted-foreground">ACCEPTED</p>
                  <h3 className="mt-1 font-semibold text-foreground">Watch registered on-chain</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    createSponsoredWatch established the campaign scope and target.
                  </p>
                  <div className="mt-4">
                    <TxLink
                      {...(createTx !== undefined ? { hash: createTx } : {})}
                      {...(createExplorer !== undefined ? { explorerUrl: createExplorer } : {})}
                      label="Creation transaction"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-black">
                  <FileCheck2 aria-hidden="true" className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-muted-foreground">PUBLISHED</p>
                  <h3 className="mt-1 font-semibold text-foreground">Report committed on-chain</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    publishSponsoredReport binds the report body to the source-event root.
                  </p>
                  <div className="mt-4">
                    <TxLink
                      {...(reportTx !== undefined ? { hash: reportTx } : {})}
                      {...(reportExplorer !== undefined ? { explorerUrl: reportExplorer } : {})}
                      label="Publication transaction"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="grid gap-5 border-t border-border p-5 text-sm sm:grid-cols-2 sm:p-6">
            {sourceEventRoot ? (
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Fingerprint aria-hidden="true" className="h-4 w-4 text-foreground" />
                  Source-event root
                </div>
                <p className="mt-2 break-all font-mono text-xs leading-relaxed text-foreground" data-testid="watch-source-event-root">
                  {sourceEventRoot}
                </p>
              </div>
            ) : null}
            {reportContentHash ? (
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <FileCheck2 aria-hidden="true" className="h-4 w-4 text-foreground" />
                  Report content hash
                </div>
                <p className="mt-2 break-all font-mono text-xs leading-relaxed text-foreground">
                  {reportContentHash}
                </p>
              </div>
            ) : null}
          </div>
          {(watch.createKeeperHubRunId || watch.reportKeeperHubRunId) ? (
            <div className="grid gap-4 border-t border-border bg-muted/20 p-5 text-sm sm:grid-cols-2 sm:p-6">
              {watch.createKeeperHubRunId ? (
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Create KeeperHub run</dt>
                  <dd className="mt-1 break-all font-mono text-xs text-foreground">{watch.createKeeperHubRunId}</dd>
                </div>
              ) : null}
              {watch.reportKeeperHubRunId ? (
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Report KeeperHub run</dt>
                  <dd className="mt-1 break-all font-mono text-xs text-foreground">{watch.reportKeeperHubRunId}</dd>
                </div>
              ) : null}
            </div>
          ) : null}
        </Surface>
      </PageSection>

      {(displaySummary || (displayHighlights && displayHighlights.length > 0)) && (
        <PageSection
          title="Campaign report"
          description="A decision-ready readout of what the watch captured, how the activity behaved, and what evidence supports it."
          data-testid="watch-report-body"
        >
          <Surface className="overflow-hidden">
            <div className="grid lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
              <div className="p-5 sm:p-6">
                <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground">
                  <Activity aria-hidden="true" className="h-4 w-4 text-foreground" />
                  KEY FINDINGS
                </div>
                {displayHighlights && displayHighlights.length > 0 ? (
                  <ul className="mt-4 space-y-3" data-testid="watch-report-highlights">
                    {displayHighlights.map((line, index) => (
                      <li key={`${line}-${index}`} className="flex gap-3 text-sm leading-relaxed text-foreground">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                        <span><HighlightText line={line} /></span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 text-sm text-muted-foreground">No findings were recorded for this campaign.</p>
                )}
              </div>

              <div className="border-t border-border bg-muted/20 p-5 sm:p-6 lg:border-l lg:border-t-0">
                <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground">
                  <FileCheck2 aria-hidden="true" className="h-4 w-4 text-foreground" />
                  ANALYST READOUT
                </div>
                <div className="mt-4 space-y-4">
                  {reportBlocks.length > 0 ? (
                    reportBlocks.map((block, index) => (
                      <div key={`${block.heading ?? "block"}-${index}`}>
                        {block.heading ? (
                          <h3 className="text-sm font-semibold text-foreground">{block.heading}</h3>
                        ) : null}
                        <p className={`${block.heading ? "mt-1" : ""} whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground`}>
                          {block.body}
                        </p>
                      </div>
                    ))
                  ) : displaySummary ? (
                    <p className="text-sm leading-relaxed text-muted-foreground">{displaySummary}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">The analyst readout is not available.</p>
                  )}
                </div>
              </div>
            </div>
          </Surface>
        </PageSection>
      )}

      {watch.contentUri ? <ContentUriFooter uri={watch.contentUri} /> : null}
    </Page>
  );
}
