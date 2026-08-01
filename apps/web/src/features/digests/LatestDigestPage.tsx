import type { ReactElement } from "react";
import { EmptyState, LoadingState, RetryState } from "../../components/state-views.tsx";
import { chainLabel } from "../../lib/explorer.ts";
import { DigestAnalysisSections } from "./DigestAnalysisSections.tsx";
import { DigestHighlights } from "./DigestHighlights.tsx";
import { useLatestDigest } from "./use-latest-digest.ts";

export function LatestDigestPage(): ReactElement {
  const { state, refetch } = useLatestDigest();

  if (state.status === "loading") {
    return (
      <LoadingState
        message="Loading latest digest..."
        variant="digest"
        data-testid="digest-loading"
      />
    );
  }

  if (state.status === "not-found") {
    return (
      <div className="max-w-4xl mx-auto">
        <EmptyState
          title="No digest available"
          description="No daily digest has been published yet. Digests appear after the first scheduled generation run."
          data-testid="digest-not-found"
        />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="max-w-4xl mx-auto">
        <RetryState
          title="Failed to load digest"
          message={state.error}
          onRetry={refetch}
          data-testid="digest-error"
        />
      </div>
    );
  }

  const { data: digest } = state;

  return (
    <div data-testid="digest-latest" className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1
          className="text-3xl font-bold tracking-tight text-foreground mb-3"
          style={{ fontFamily: "var(--font-space-grotesk)" }}
        >
          {digest.title}
        </h1>
        <div className="flex gap-4 items-center flex-wrap">
          <span className="text-muted-foreground text-sm font-medium">
            {digest.publishedAt
              ? new Date(digest.publishedAt).toLocaleDateString("en-US", {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : digest.reportDate}
          </span>
          <span
            className={`px-3 py-1 rounded-full text-xs font-semibold ${
              digest.publicationStatus === "published"
                ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                : digest.publicationStatus === "partial_failure"
                  ? "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                  : "bg-rose-500/10 text-rose-500 border border-rose-500/20"
            }`}
          >
            {digest.publicationStatus.replace(/_/g, " ")}
          </span>
          <span className="text-xs text-muted-foreground">
            {digest.digestKind ?? "desk"} · {chainLabel(digest.chainId ?? 11155111)} ·{" "}
            {digest.sourceAlertIds.length} alerts / {digest.sourceSignalIds.length} signals
          </span>
        </div>
      </div>

      {/* Highlights with Registry Transaction Link */}
      <DigestHighlights
        highlights={digest.highlights}
        registryTxHash={digest.registryTxHash}
        contentHash={digest.contentHash}
        sourceEventRoot={digest.sourceEventRoot}
        gasUsed={digest.gasUsed}
        gasUsedWei={digest.gasUsedWei}
        keeperHubRunId={digest.keeperHubRunId}
        explorerUrl={digest.explorerUrl}
      />

      {/* Analysis Sections (facts vs interpretation) */}
      <DigestAnalysisSections
        summary={digest.summary}
        analysis={digest.analysis}
        reportDate={digest.reportDate}
      />

      <div className="mt-4 text-xs text-muted-foreground" data-testid="digest-causal-sources">
        Evidence graph: {digest.sourceIntentIds.length} intents / {digest.sourceTicketIds.length}{" "}
        tickets.
      </div>

      {/* Self-hosted content permalink */}
      {digest.contentUri && (
        <div className="mt-8 text-center">
          <span className="inline-flex items-center gap-2 px-4 py-2.5 bg-muted/30 border border-border text-muted-foreground rounded-xl text-sm font-mono">
            {digest.contentUri}
          </span>
        </div>
      )}
    </div>
  );
}
