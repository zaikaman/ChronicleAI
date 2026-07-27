// Alerts page with filtering and state management

import { useState, useMemo, type ReactElement } from "react";
import { useAlerts } from "./use-alerts.ts";
import { AlertCard } from "./AlertCard.tsx";
import { AlertFilters, type AlertFiltersState } from "./AlertFilters.tsx";
import { LoadingState, EmptyState, ErrorState, RetryState } from "../../components/state-views.tsx";

export function AlertsPage(): ReactElement {
  const { alerts, isLoading, error, refetch } = useAlerts(100);
  const [filters, setFilters] = useState<AlertFiltersState>({
    eventType: "",
    chainId: "",
  });

  const filteredAlerts = useMemo(() => {
    // Note: chainId is not in the PublicAlertResponse, so this is a client-side filter
    // In a production app, these would be server-side filters
    if (!filters.eventType) return alerts;
    // Filter by event type embedded in alert title for now
    return alerts.filter((a) => {
      const titleLower = a.title.toLowerCase();
      const typeLabel = filters.eventType.replace(/_/g, " ");
      return titleLower.includes(typeLabel) || titleLower.includes(filters.eventType.replace(/_/g, " "));
    });
  }, [alerts, filters.eventType]);

  if (isLoading) {
    return <LoadingState message="Loading alerts..." data-testid="alerts-loading" />;
  }

  if (error) {
    return (
      <RetryState
        title="Failed to load alerts"
        message={error}
        onRetry={refetch}
        data-testid="alerts-error"
      />
    );
  }

  if (alerts.length === 0) {
    return (
      <>
        <h1 style={{ fontSize: "var(--font-size-2xl)", fontWeight: 700, marginBottom: "1rem" }}>
          Public Alerts
        </h1>
        <EmptyState
          title="No alerts yet"
          description="Public alerts will appear here when significant on-chain events are detected."
          data-testid="alerts-empty"
        />
      </>
    );
  }

  if (filters.eventType && filteredAlerts.length === 0) {
    return (
      <div data-testid="alerts-filtered-empty">
        <h1 style={{ fontSize: "var(--font-size-2xl)", fontWeight: 700, marginBottom: "1rem" }}>
          Public Alerts
        </h1>
        <AlertFilters filters={filters} onChange={setFilters} />
        <EmptyState
          title="No matching alerts"
          description={`No alerts found for event type: ${filters.eventType}. Try a different filter.`}
        />
      </div>
    );
  }

  return (
    <div data-testid="alerts-list">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem",
        }}
      >
        <h1 style={{ fontSize: "var(--font-size-2xl)", fontWeight: 700 }}>
          Public Alerts
        </h1>
        <span className="text-tertiary" style={{ fontSize: "var(--font-size-sm)" }}>
          {filteredAlerts.length} alert{filteredAlerts.length !== 1 ? "s" : ""}
        </span>
      </div>

      <AlertFilters filters={filters} onChange={setFilters} />

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {filteredAlerts.map((alert) => (
          <AlertCard key={alert.id} alert={alert} data-testid={`alert-${alert.id}`} />
        ))}
      </div>
    </div>
  );
}
