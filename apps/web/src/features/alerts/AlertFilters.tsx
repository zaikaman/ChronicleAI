import type React from "react";

export interface AlertFiltersState {
  eventType: string;
  chainId: string;
}

export interface AlertFilterOption {
  value: string;
  label: string;
}

interface AlertFiltersProps {
  filters: AlertFiltersState;
  onChange: (filters: AlertFiltersState) => void;
  eventTypeOptions: AlertFilterOption[];
  chainOptions: AlertFilterOption[];
  "data-testid"?: string;
}

export function AlertFilters({
  filters,
  onChange,
  eventTypeOptions,
  chainOptions,
  "data-testid": dataTestId = "alert-filters",
}: AlertFiltersProps): React.ReactElement {
  return (
    <div
      data-testid={dataTestId}
      className="flex gap-6 mb-6 flex-wrap items-center bg-muted/20 border border-border p-4 rounded-2xl"
    >
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="event-type-filter"
          className="text-xs font-medium text-muted-foreground"
        >
          Event type
        </label>
        <select
          id="event-type-filter"
          data-testid="event-type-filter"
          value={filters.eventType}
          onChange={(e) => onChange({ ...filters, eventType: e.target.value })}
          className="px-3.5 py-2 bg-frame border border-border rounded-xl text-foreground text-sm cursor-pointer min-w-[180px] focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="" className="bg-frame text-foreground">
            All Events
          </option>
          {eventTypeOptions.map((type) => (
            <option key={type.value} value={type.value} className="bg-frame text-foreground">
              {type.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="chain-filter"
          className="text-xs font-medium text-muted-foreground"
        >
          Chain
        </label>
        <select
          id="chain-filter"
          data-testid="chain-filter"
          value={filters.chainId}
          onChange={(e) => onChange({ ...filters, chainId: e.target.value })}
          className="px-3.5 py-2 bg-frame border border-border rounded-xl text-foreground text-sm cursor-pointer min-w-[180px] focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="" className="bg-frame text-foreground">
            All Chains
          </option>
          {chainOptions.map((chain) => (
            <option key={chain.value} value={chain.value} className="bg-frame text-foreground">
              {chain.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
