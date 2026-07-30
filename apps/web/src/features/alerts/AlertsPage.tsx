import { type ReactElement, useMemo, useState } from "react";
import { PaginationControls } from "../../components/pagination-controls.tsx";
import { Page, PageHeader } from "../../components/page-chrome.tsx";
import { EmptyState, LoadingState, RetryState } from "../../components/state-views.tsx";
import { chainLabel } from "../../lib/explorer.ts";
import { AlertCard } from "./AlertCard.tsx";
import { AlertFilters, type AlertFiltersState } from "./AlertFilters.tsx";
import { useAlerts } from "./use-alerts.ts";

function formatEventTypeLabel(eventType: string): string {
  return eventType
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function AlertsPage(): ReactElement {
  const { alerts, pagination, setPage, isLoading, error, refetch } = useAlerts(20);
  const [filters, setFilters] = useState<AlertFiltersState>({
    eventType: "",
    chainId: "",
  });

  const visibleAlerts = useMemo(() => {
    return alerts.filter((alert) => alert.deliveryStatus !== "draft");
  }, [alerts]);

  const eventTypeOptions = useMemo(() => {
    const types = new Set<string>();
    for (const alert of visibleAlerts) {
      if (alert.eventType) types.add(alert.eventType);
    }
    return [...types]
      .sort()
      .map((value) => ({ value, label: formatEventTypeLabel(value) }));
  }, [visibleAlerts]);

  const chainOptions = useMemo(() => {
    const chains = new Set<number>();
    for (const alert of visibleAlerts) {
      if (typeof alert.chainId === "number") chains.add(alert.chainId);
    }
    return [...chains]
      .sort((a, b) => a - b)
      .map((id) => ({
        value: String(id),
        label: chainLabel(id),
      }));
  }, [visibleAlerts]);

  const filteredAlerts = useMemo(() => {
    return visibleAlerts.filter((alert) => {
      if (filters.eventType && alert.eventType !== filters.eventType) {
        return false;
      }
      if (filters.chainId && String(alert.chainId ?? "") !== filters.chainId) {
        return false;
      }
      return true;
    });
  }, [visibleAlerts, filters.eventType, filters.chainId]);

  const hasActiveFilters = Boolean(filters.eventType || filters.chainId);

  return (
    <Page data-testid="alerts-list">
      <PageHeader
        title="Public Alerts"
        description="Live public market bulletins from on-chain events — plain-language summaries with proof of publication."
        meta={
          !isLoading && !error ? (
            <span className="tabular-nums">
              {visibleAlerts.length} alert{visibleAlerts.length !== 1 ? "s" : ""}
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
      ) : visibleAlerts.length === 0 && pagination.page === 1 ? (
        <EmptyState
          title="No alerts yet"
          description="Public alerts will appear here when significant on-chain events are detected."
          data-testid="alerts-empty"
        />
      ) : (
        <>
          {(eventTypeOptions.length > 0 || chainOptions.length > 0) && (
            <AlertFilters
              filters={filters}
              onChange={setFilters}
              eventTypeOptions={eventTypeOptions}
              chainOptions={chainOptions}
            />
          )}

          {hasActiveFilters && filteredAlerts.length === 0 ? (
            <EmptyState
              title="No matching alerts"
              description="No alerts on this page match the selected filters. Try a different event type, chain, or page."
              data-testid="alerts-filtered-empty"
            />
          ) : (
            <div className="flex flex-col gap-4">
              {filteredAlerts.map((alert) => (
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
