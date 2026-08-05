import { EVENT_TYPES } from "@chronicleai/schemas";
import { type ReactElement, useMemo, useState } from "react";
import { Page, PageHeader } from "../../components/page-chrome.tsx";
import { PaginationControls } from "../../components/pagination-controls.tsx";
import { EmptyState, LoadingState, RetryState } from "../../components/state-views.tsx";
import { AlertCard } from "./AlertCard.tsx";
import { AlertFilters, type AlertFiltersState } from "./AlertFilters.tsx";
import { useAlerts } from "./use-alerts.ts";

function formatEventTypeLabel(eventType: string): string {
  return eventType
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function emptyCopy(scope: AlertFiltersState["scope"]): { title: string; description: string } {
  switch (scope) {
    case "market":
      return {
        title: "No market Alerts yet",
        description:
          "Market-event Alerts appear here when significant on-chain activity is detected on the primary signal source.",
      };
    case "desk":
      return {
        title: "No Desk-trigger Alerts yet",
        description:
          "Desk-trigger Alerts appear when Chronicle Desk records a material condition — health factor, oracle basis, APY differential, gas regime, or capital move — that produces a non-ignore decision.",
      };
    default:
      return {
        title: "No alerts yet",
        description:
          "Public updates will appear here when the market changes or the Desk makes a decision. Each card explains what happened and what followed.",
      };
  }
}

const STATIC_ALERT_KIND_OPTIONS = [
  { value: "market_event", label: "Market event" },
  { value: "desk_trigger", label: "Desk trigger" },
];

const STATIC_SIGNAL_STATUS_OPTIONS = [
  { value: "not_eligible", label: "No separate check" },
  { value: "pending", label: "Checking" },
  { value: "created", label: "Recorded" },
  { value: "failed", label: "Check failed" },
];

export function AlertsPage(): ReactElement {
  const [filters, setFilters] = useState<AlertFiltersState>({
    scope: "all",
    eventType: "",
    alertKind: "",
    signalStatus: "",
  });

  const serverFilters = useMemo(
    () => ({
      scope: filters.scope,
      ...(filters.eventType ? { eventType: filters.eventType } : {}),
      ...(filters.alertKind ? { alertKind: filters.alertKind } : {}),
      ...(filters.signalStatus ? { signalStatus: filters.signalStatus } : {}),
    }),
    [filters.scope, filters.eventType, filters.alertKind, filters.signalStatus],
  );

  const { alerts, pagination, setPage, isLoading, error, refetch } = useAlerts(20, serverFilters);

  const eventTypeOptions = useMemo(() => {
    const types = new Set<string>(EVENT_TYPES);
    for (const alert of alerts) {
      if (alert.eventType) types.add(alert.eventType);
    }
    return [...types].sort().map((value) => ({ value, label: formatEventTypeLabel(value) }));
  }, [alerts]);

  const hasActiveFilters = Boolean(filters.eventType || filters.alertKind || filters.signalStatus);
  const empty = emptyCopy(filters.scope);

  return (
    <Page data-testid="alerts-list">
      <PageHeader
        title="Alerts"
        description="Clear updates about market events and Chronicle Desk decisions. Each alert explains what was noticed, what the desk decided, and whether anything happened next."
        meta={
          !isLoading && !error ? (
            <span className="tabular-nums" data-testid="alerts-count">
              {pagination.total} alert{pagination.total !== 1 ? "s" : ""}
              {pagination.totalPages > 1
                ? ` · page ${pagination.page}/${pagination.totalPages}`
                : ""}
            </span>
          ) : undefined
        }
      />

      {isLoading ? (
        <LoadingState
          message="Loading alerts..."
          variant="cards"
          count={4}
          data-testid="alerts-loading"
        />
      ) : error ? (
        <RetryState
          title="Failed to load alerts"
          message={error}
          onRetry={refetch}
          data-testid="alerts-error"
        />
      ) : (
        <>
          <AlertFilters
            filters={filters}
            onChange={setFilters}
            eventTypeOptions={eventTypeOptions}
            alertKindOptions={STATIC_ALERT_KIND_OPTIONS}
            signalStatusOptions={STATIC_SIGNAL_STATUS_OPTIONS}
          />

          {alerts.length === 0 && pagination.page === 1 && !hasActiveFilters ? (
            <EmptyState
              title={empty.title}
              description={empty.description}
              data-testid="alerts-empty"
            />
          ) : alerts.length === 0 ? (
            <EmptyState
              title="No matching alerts"
              description="No alerts match the selected scope and filters. Try a different source, kind, or page."
              data-testid="alerts-filtered-empty"
            />
          ) : (
            <div className="flex flex-col gap-4">
              {alerts.map((alert) => (
                <AlertCard key={alert.id} alert={alert} data-testid={`alert-${alert.id}`} />
              ))}
            </div>
          )}

          <PaginationControls
            pagination={pagination}
            onPageChange={setPage}
            disabled={isLoading}
            data-testid="alerts-pagination"
          />
        </>
      )}
    </Page>
  );
}
