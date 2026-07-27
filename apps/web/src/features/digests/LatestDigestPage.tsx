// Latest Digest page: displays the most recent published daily digest

import type { ReactElement } from "react";
import { EmptyState, LoadingState, RetryState } from "../../components/state-views.tsx";
import { DigestAnalysisSections } from "./DigestAnalysisSections.tsx";
import { DigestHighlights } from "./DigestHighlights.tsx";
import { useLatestDigest } from "./use-latest-digest.ts";

export function LatestDigestPage(): ReactElement {
  const { state, refetch } = useLatestDigest();

  if (state.status === "loading") {
    return <LoadingState message="Loading latest digest..." data-testid="digest-loading" />;
  }

  if (state.status === "not-found") {
    return (
      <EmptyState
        title="No digest available"
        description="No daily digest has been published yet. Digests appear after the first scheduled generation run."
        data-testid="digest-not-found"
      />
    );
  }

  if (state.status === "error") {
    return (
      <RetryState
        title="Failed to load digest"
        message={state.error}
        onRetry={refetch}
        data-testid="digest-error"
      />
    );
  }

  const { data: digest } = state;

  return (
    <div data-testid="digest-latest">
      {/* Header */}
      <div
        style={{
          marginBottom: "2rem",
        }}
      >
        <h1
          style={{
            fontSize: "var(--font-size-2xl)",
            fontWeight: 700,
            marginBottom: "0.5rem",
          }}
        >
          {digest.title}
        </h1>
        <div
          style={{
            display: "flex",
            gap: "1rem",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: "var(--font-size-sm)",
              color: "var(--fg-secondary)",
            }}
          >
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
            style={{
              padding: "0.125rem 0.5rem",
              borderRadius: "999px",
              fontSize: "var(--font-size-xs)",
              fontWeight: 600,
              background:
                digest.publicationStatus === "published"
                  ? "rgba(34, 197, 94, 0.1)"
                  : digest.publicationStatus === "partial_failure"
                    ? "rgba(234, 179, 8, 0.1)"
                    : "rgba(239, 68, 68, 0.1)",
              color:
                digest.publicationStatus === "published"
                  ? "rgb(34, 197, 94)"
                  : digest.publicationStatus === "partial_failure"
                    ? "rgb(234, 179, 8)"
                    : "rgb(239, 68, 68)",
            }}
          >
            {digest.publicationStatus.replace(/_/g, " ")}
          </span>
        </div>
      </div>

      {/* Highlights with Registry Transaction Link */}
      <DigestHighlights highlights={digest.highlights} registryTxHash={digest.registryTxHash} />

      {/* Analysis Sections (facts vs interpretation) */}
      <DigestAnalysisSections
        summary={digest.summary}
        analysis={digest.analysis}
        reportDate={digest.reportDate}
      />

      {/* Content Link */}
      {digest.contentUri && (
        <div
          style={{
            marginTop: "1.5rem",
            textAlign: "center",
          }}
        >
          <a
            href={digest.contentUri}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.75rem 1.5rem",
              background: "var(--accent-primary)",
              color: "white",
              borderRadius: "8px",
              fontWeight: 600,
              fontSize: "var(--font-size-sm)",
              textDecoration: "none",
            }}
          >
            View on Webflow
            <span aria-hidden="true">&rarr;</span>
          </a>
        </div>
      )}
    </div>
  );
}
