import type { ReactElement } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ContentUriFooter,
  Page,
  PageBackLink,
} from "../../components/page-chrome.tsx";
import { EmptyState, LoadingState, RetryState } from "../../components/state-views.tsx";
import { DeskActedBanner } from "../desk/DeskActedBanner.tsx";
import { useRelatedDeskTicket } from "../desk/use-desk.ts";
import { AlertCard } from "./AlertCard.tsx";
import { useAlert } from "./use-alert.ts";

export function AlertDetailPage(): ReactElement {
  const { alertId } = useParams<{ alertId: string }>();
  const { state, refetch } = useAlert(alertId);
  const relatedTicket = useRelatedDeskTicket({
    sourceEventHash:
      state.status === "success" ? state.data.sourceEventHash : undefined,
    sourceReferences:
      state.status === "success" ? state.data.sourceReferences : undefined,
  });

  if (state.status === "loading") {
    return (
      <Page data-testid="alert-detail">
        <LoadingState
          message="Loading alert..."
          variant="detail"
          data-testid="alert-detail-loading"
        />
      </Page>
    );
  }

  if (state.status === "not-found") {
    return (
      <Page data-testid="alert-detail">
        <PageBackLink to="/alerts">All alerts</PageBackLink>
        <EmptyState
          title="Alert not found"
          description="This alert is not published or the content URI is invalid."
          data-testid="alert-detail-not-found"
        />
        <div className="mt-4 text-center">
          <Link
            to="/alerts"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Back to all alerts
          </Link>
        </div>
      </Page>
    );
  }

  if (state.status === "error") {
    return (
      <Page data-testid="alert-detail">
        <PageBackLink to="/alerts">All alerts</PageBackLink>
        <RetryState
          title="Failed to load alert"
          message={state.error}
          onRetry={refetch}
          data-testid="alert-detail-error"
        />
      </Page>
    );
  }

  return (
    <Page data-testid="alert-detail">
      <PageBackLink to="/alerts">All alerts</PageBackLink>
      {relatedTicket.ticket ? <DeskActedBanner ticket={relatedTicket.ticket} /> : null}
      <AlertCard alert={state.data} linkable={false} data-testid="alert-detail-card" />
      {state.data.contentUri ? <ContentUriFooter uri={state.data.contentUri} /> : null}
      {state.data.explorerUrl ? (
        <div className="mt-3 text-center">
          <a
            href={state.data.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            View registry proof on explorer
          </a>
        </div>
      ) : null}
    </Page>
  );
}
