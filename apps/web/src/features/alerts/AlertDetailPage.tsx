import type { ReactElement } from "react";
import { Link, useParams } from "react-router-dom";
import { EmptyState, LoadingState, RetryState } from "../../components/state-views.tsx";
import { AlertCard } from "./AlertCard.tsx";
import { useAlert } from "./use-alert.ts";

export function AlertDetailPage(): ReactElement {
  const { alertId } = useParams<{ alertId: string }>();
  const { state, refetch } = useAlert(alertId);

  if (state.status === "loading") {
    return <LoadingState message="Loading alert..." data-testid="alert-detail-loading" />;
  }

  if (state.status === "not-found") {
    return (
      <div className="max-w-4xl mx-auto">
        <EmptyState
          title="Alert not found"
          description="This alert is not published or the content URI is invalid."
          data-testid="alert-detail-not-found"
        />
        <div className="mt-4 text-center">
          <Link to="/alerts" className="text-accent hover:underline text-sm font-medium">
            Back to all alerts
          </Link>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="max-w-4xl mx-auto">
        <RetryState
          title="Failed to load alert"
          message={state.error}
          onRetry={refetch}
          data-testid="alert-detail-error"
        />
      </div>
    );
  }

  return (
    <div data-testid="alert-detail" className="max-w-4xl mx-auto">
      <div className="mb-6">
        <Link to="/alerts" className="text-accent hover:underline text-sm font-medium">
          ← All alerts
        </Link>
      </div>
      <AlertCard alert={state.data} data-testid="alert-detail-card" />
      {state.data.contentUri && (
        <div className="mt-6 text-center">
          <span className="inline-flex items-center gap-2 px-4 py-2.5 bg-muted/30 border border-border text-muted-foreground rounded-xl text-sm font-mono break-all">
            {state.data.contentUri}
          </span>
        </div>
      )}
      {state.data.explorerUrl && (
        <div className="mt-3 text-center">
          <a
            href={state.data.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline text-sm font-medium"
          >
            View registry proof on explorer
          </a>
        </div>
      )}
    </div>
  );
}
