import { type ReactElement, useMemo, useState } from "react";
import { EmptyState, LoadingState, RetryState } from "../../components/state-views.tsx";
import { AlertCard } from "./AlertCard.tsx";
import { AlertFilters, type AlertFiltersState } from "./AlertFilters.tsx";
import { useAlerts } from "./use-alerts.ts";

export function AlertsPage(): ReactElement {
  const { alerts, isLoading, error, refetch } = useAlerts(100);
  const [filters, setFilters] = useState<AlertFiltersState>({
    eventType: "",
    chainId: "",
  });

  const filteredAlerts = useMemo(() => {
    if (!filters.eventType) return alerts;
    return alerts.filter((a) => {
      const titleLower = a.title.toLowerCase();
      const typeLabel = filters.eventType.replace(/_/g, " ");
      return (
        titleLower.includes(typeLabel) || titleLower.includes(filters.eventType.replace(/_/g, " "))
      );
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
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold tracking-tight text-foreground mb-6" style={{ fontFamily: "var(--font-space-grotesk)" }}>
          Public Alerts
        </h1>
        <EmptyState
          title="No alerts yet"
          description="Public alerts will appear here when significant on-chain events are detected."
          data-testid="alerts-empty"
        />
      </div>
    );
  }

  if (filters.eventType && filteredAlerts.length === 0) {
    return (
      <div data-testid="alerts-filtered-empty" className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold tracking-tight text-foreground mb-6" style={{ fontFamily: "var(--font-space-grotesk)" }}>
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
    <div data-testid="alerts-list" className="max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-foreground" style={{ fontFamily: "var(--font-space-grotesk)" }}>
          Public Alerts
        </h1>
        <span className="text-muted-foreground text-sm font-medium">
          {filteredAlerts.length} alert{filteredAlerts.length !== 1 ? "s" : ""}
        </span>
      </div>

      <AlertFilters filters={filters} onChange={setFilters} />

      <div className="flex flex-col gap-4 mt-6">
        {filteredAlerts.map((alert) => (
          <AlertCard key={alert.id} alert={alert} data-testid={`alert-${alert.id}`} />
        ))}
      </div>
    </div>
  );
}
