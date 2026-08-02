import type React from "react";

export interface AlertFiltersState {
  eventType: string;
  alertKind: string;
  signalStatus: string;
}

export interface AlertFilterOption {
  value: string;
  label: string;
}

interface AlertFiltersProps {
  filters: AlertFiltersState;
  onChange: (filters: AlertFiltersState) => void;
  eventTypeOptions: AlertFilterOption[];
  alertKindOptions: AlertFilterOption[];
  signalStatusOptions: AlertFilterOption[];
  "data-testid"?: string;
}

export function AlertFilters({
  filters,
  onChange,
  eventTypeOptions,
  alertKindOptions,
  signalStatusOptions,
  "data-testid": dataTestId = "alert-filters",
}: AlertFiltersProps): React.ReactElement {
  return (
    <div
      data-testid={dataTestId}
      className="flex gap-6 mb-6 flex-wrap items-center bg-muted/20 border border-border p-4 rounded-2xl"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="event-type-filter" className="text-xs font-medium text-muted-foreground">
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
        <label htmlFor="alert-kind-filter" className="text-xs font-medium text-muted-foreground">
          Alert kind
        </label>
        <select
          id="alert-kind-filter"
          data-testid="alert-kind-filter"
          value={filters.alertKind}
          onChange={(e) => onChange({ ...filters, alertKind: e.target.value })}
          className="px-3.5 py-2 bg-frame border border-border rounded-xl text-foreground text-sm cursor-pointer min-w-[180px] focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="" className="bg-frame text-foreground">
            All Kinds
          </option>
          {alertKindOptions.map((kind) => (
            <option key={kind.value} value={kind.value} className="bg-frame text-foreground">
              {kind.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="signal-status-filter" className="text-xs font-medium text-muted-foreground">
          Signal state
        </label>
        <select
          id="signal-status-filter"
          data-testid="signal-status-filter"
          value={filters.signalStatus}
          onChange={(e) => onChange({ ...filters, signalStatus: e.target.value })}
          className="px-3.5 py-2 bg-frame border border-border rounded-xl text-foreground text-sm cursor-pointer min-w-[180px] focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="" className="bg-frame text-foreground">
            All Signal States
          </option>
          {signalStatusOptions.map((status) => (
            <option key={status.value} value={status.value} className="bg-frame text-foreground">
              {status.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
