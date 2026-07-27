// Alert filter controls for event type and chain

import type React from "react";

export interface AlertFiltersState {
  eventType: string;
  chainId: string;
}

interface AlertFiltersProps {
  filters: AlertFiltersState;
  onChange: (filters: AlertFiltersState) => void;
  "data-testid"?: string;
}

const EVENT_TYPES = [
  { value: "", label: "All Events" },
  { value: "large_swap", label: "Large Swaps" },
  { value: "liquidation", label: "Liquidations" },
  { value: "gas_spike", label: "Gas Spikes" },
  { value: "volume_anomaly", label: "Volume Anomalies" },
  { value: "contract_deployment", label: "Contract Deployments" },
] as const;

const CHAINS = [
  { value: "", label: "All Chains" },
  { value: "1", label: "Ethereum" },
  { value: "137", label: "Polygon" },
  { value: "56", label: "BSC" },
  { value: "42161", label: "Arbitrum" },
] as const;

export function AlertFilters({
  filters,
  onChange,
  "data-testid": dataTestId = "alert-filters",
}: AlertFiltersProps): React.ReactElement {
  return (
    <div
      data-testid={dataTestId}
      style={{
        display: "flex",
        gap: "1rem",
        marginBottom: "1.5rem",
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <label
          htmlFor="event-type-filter"
          style={{ fontSize: "var(--font-size-xs)", color: "var(--fg-tertiary)" }}
        >
          Event Type
        </label>
        <select
          id="event-type-filter"
          data-testid="event-type-filter"
          value={filters.eventType}
          onChange={(e) => onChange({ ...filters, eventType: e.target.value })}
          style={{
            padding: "0.5rem 0.75rem",
            background: "var(--bg-glass)",
            border: "1px solid var(--border-primary)",
            borderRadius: "8px",
            color: "var(--fg-primary)",
            fontSize: "var(--font-size-sm)",
            cursor: "pointer",
            minWidth: "160px",
          }}
        >
          {EVENT_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <label
          htmlFor="chain-filter"
          style={{ fontSize: "var(--font-size-xs)", color: "var(--fg-tertiary)" }}
        >
          Chain
        </label>
        <select
          id="chain-filter"
          data-testid="chain-filter"
          value={filters.chainId}
          onChange={(e) => onChange({ ...filters, chainId: e.target.value })}
          style={{
            padding: "0.5rem 0.75rem",
            background: "var(--bg-glass)",
            border: "1px solid var(--border-primary)",
            borderRadius: "8px",
            color: "var(--fg-primary)",
            fontSize: "var(--font-size-sm)",
            cursor: "pointer",
            minWidth: "160px",
          }}
        >
          {CHAINS.map((chain) => (
            <option key={chain.value} value={chain.value}>
              {chain.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
