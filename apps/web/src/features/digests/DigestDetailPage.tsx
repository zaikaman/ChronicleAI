import type { ReactElement } from "react";
import { Link, useParams } from "react-router-dom";
import { StatusBadge } from "../../components/data-primitives.tsx";
import {
  ContentUriFooter,
  Page,
  PageHeader,
} from "../../components/page-chrome.tsx";
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
    return (
      <Page data-testid="digest-detail">
        <LoadingState
          message="Loading digest..."
          variant="digest"
          data-testid="digest-loading"
        />
      </Page>
    );
  }

  if (state.status === "not-found") {
    return (
      <Page data-testid="digest-detail">
        <PageHeader
          title="Daily Digest"
          description="Latest autonomous intelligence report from on-chain market activity."
        />
        <EmptyState
          title="No digest available"
          description="This digest has not been published yet, or the content URI is invalid."
          data-testid="digest-not-found"
        />
        <div className="mt-4 text-center">
          <Link
            to="/digests/latest"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            View latest digest
          </Link>
        </div>
      </Page>
    );
  }

  if (state.status === "error") {
    return (
      <Page data-testid="digest-detail">
        <PageHeader
          title="Daily Digest"
          description="Latest autonomous intelligence report from on-chain market activity."
        />
        <RetryState
          title="Failed to load digest"
          message={state.error}
          onRetry={refetch}
          data-testid="digest-error"
        />
      </Page>
    );
  }

  const { data: digest } = state;

  const publishedLabel = digest.publishedAt
    ? new Date(digest.publishedAt).toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : digest.reportDate;

  const statusVariant =
    digest.publicationStatus === "published"
      ? "success"
      : digest.publicationStatus === "partial_failure"
        ? "warning"
        : "error";

  return (
    <Page data-testid="digest-detail">
      <PageHeader
        title={digest.title}
        description={publishedLabel}
        below={
          <StatusBadge
            label={digest.publicationStatus.replace(/_/g, " ")}
            variant={statusVariant}
          />
        }
      />

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

      <DigestAnalysisSections
        summary={digest.summary}
        analysis={digest.analysis}
        sections={digest.sections}
        reportDate={digest.reportDate}
      />

      {digest.contentUri ? <ContentUriFooter uri={digest.contentUri} /> : null}
    </Page>
  );
}
