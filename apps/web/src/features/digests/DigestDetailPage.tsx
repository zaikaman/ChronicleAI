import type { ReactElement } from "react";
import { Link, useParams } from "react-router-dom";
import { EmptyState, LoadingState, RetryState } from "../../components/state-views.tsx";
import { DigestAnalysisSections } from "./DigestAnalysisSections.tsx";
import { DigestHighlights } from "./DigestHighlights.tsx";
import { useDigest } from "./use-digest.ts";

/**
 * Public digest page used as the HTTPS content URI target for on-chain proofs.
 * Supports both `/digests/latest` and `/digests/:digestId`.
 */
export function DigestDetailPage(): ReactElement {
  const { digestId } = useParams<{ digestId: string }>();
  const id = digestId ?? "latest";
  const { state, refetch } = useDigest(id);

  if (state.status === "loading") {
    return <LoadingState message="Loading digest..." data-testid="digest-loading" />;
  }

  if (state.status === "not-found") {
    return (
      <div className="max-w-4xl mx-auto">
        <EmptyState
          title="No digest available"
          description="This digest has not been published yet, or the content URI is invalid."
          data-testid="digest-not-found"
        />
        <div className="mt-4 text-center">
          <Link to="/digests/latest" className="text-accent hover:underline text-sm font-medium">
            View latest digest
          </Link>
        </div>
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
    <div data-testid="digest-detail" className="max-w-4xl mx-auto">
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
        </div>
      </div>

      <DigestHighlights highlights={digest.highlights} registryTxHash={digest.registryTxHash} />

      <DigestAnalysisSections
        summary={digest.summary}
        analysis={digest.analysis}
        reportDate={digest.reportDate}
      />

      {digest.contentUri && (
        <div className="mt-8 text-center">
          <span className="inline-flex items-center gap-2 px-4 py-2.5 bg-muted/30 border border-border text-muted-foreground rounded-xl text-sm font-mono break-all">
            {digest.contentUri}
          </span>
        </div>
      )}
    </div>
  );
}
