import { type ReactElement, useMemo, useState } from "react";
import { EmptyState, LoadingState, RetryState } from "../../components/state-views.tsx";
import { AlertCard } from "./AlertCard.tsx";
import { AlertFilters, type AlertFiltersState } from "./AlertFilters.tsx";
import { useAlerts } from "./use-alerts.ts";

const CHAIN_LABELS: Record<number, string> = {
  1: "Ethereum",
  8453: "Base",
  84532: "Base Sepolia",
  11155111: "Sepolia",
};

function formatEventTypeLabel(eventType: string): string {
  return eventType
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function AlertsPage(): ReactElement {
  const { alerts, isLoading, error, refetch } = useAlerts(100);
  const [filters, setFilters] = useState<AlertFiltersState>({
    eventType: "",
    chainId: "",
  });

  const eventTypeOptions = useMemo(() => {
    const types = new Set<string>();
    for (const alert of alerts) {
      if (alert.eventType) types.add(alert.eventType);
    }
    return [...types]
      .sort()
      .map((value) => ({ value, label: formatEventTypeLabel(value) }));
  }, [alerts]);

  const chainOptions = useMemo(() => {
    const chains = new Set<number>();
    for (const alert of alerts) {
      if (typeof alert.chainId === "number") chains.add(alert.chainId);
    }
    return [...chains]
      .sort((a, b) => a - b)
      .map((id) => ({
        value: String(id),
        label: CHAIN_LABELS[id] ?? `Chain ${id}`,
      }));
  }, [alerts]);

  const filteredAlerts = useMemo(() => {
    return alerts.filter((alert) => {
      if (filters.eventType && alert.eventType !== filters.eventType) {
        return false;
      }
      if (filters.chainId && String(alert.chainId ?? "") !== filters.chainId) {
        return false;
      }
      return true;
    });
  }, [alerts, filters.eventType, filters.chainId]);

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

  const hasActiveFilters = Boolean(filters.eventType || filters.chainId);

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
          description="No alerts match the selected filters. Try a different event type or chain."
          data-testid="alerts-filtered-empty"
        />
      ) : (
        <div className="flex flex-col gap-4 mt-6">
          {filteredAlerts.map((alert) => (
            <AlertCard key={alert.id} alert={alert} data-testid={`alert-${alert.id}`} />
          ))}
        </div>
      )}
    </div>
  );
}
