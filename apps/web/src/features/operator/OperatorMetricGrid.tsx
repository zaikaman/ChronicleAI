// Operator metric grid component
// Displays key metrics: revenue, costs, paid requests, alert count, digest count

import type React from "react";

interface OperatorMetricGridProps {
  metrics: {
    totalRevenue: number;
    totalAlerts: number;
    totalDigests: number;
    totalPaidRequests: number;
    totalQualifiedEvents: number;
    estimatedGenerationCost: number;
    estimatedTransactionCost: number;
  };
  isLoading?: boolean;
  "data-testid"?: string;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function OperatorMetricGrid({
  metrics,
  isLoading = false,
  "data-testid": dataTestId = "operator-metric-grid",
}: OperatorMetricGridProps): React.ReactElement {
  if (isLoading) {
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: "1rem",
        }}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={`skeleton-${i}`}
            style={{
              padding: "1rem",
              background: "var(--bg-glass)",
              borderRadius: "12px",
              border: "1px solid var(--border-primary)",
              opacity: 0.5 + i * 0.05,
            }}
          >
            <div
              style={{
                height: "12px",
                width: "60%",
                background: "var(--bg-tertiary)",
                borderRadius: "6px",
                marginBottom: "0.5rem",
              }}
            />
            <div
              style={{
                height: "24px",
                width: "40%",
                background: "var(--bg-tertiary)",
                borderRadius: "6px",
              }}
            />
          </div>
        ))}
      </div>
    );
  }

  const cardStyle: React.CSSProperties = {
    padding: "1rem",
    background: "var(--bg-glass)",
    borderRadius: "12px",
    border: "1px solid var(--border-primary)",
    transition: "border-color 0.15s ease",
  };

  return (
    <div
      data-testid={dataTestId}
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
        gap: "1rem",
      }}
    >
      <div style={cardStyle}>
        <div
          style={{
            fontSize: "var(--font-size-xs)",
            color: "var(--fg-tertiary)",
            marginBottom: "0.25rem",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Total Revenue
        </div>
        <div
          style={{
            fontSize: "var(--font-size-xl)",
            fontWeight: 700,
            color: "var(--accent-success)",
          }}
        >
          {formatCurrency(metrics.totalRevenue)}
        </div>
      </div>

      <div style={cardStyle}>
        <div
          style={{
            fontSize: "var(--font-size-xs)",
            color: "var(--fg-tertiary)",
            marginBottom: "0.25rem",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Gen Cost Est.
        </div>
        <div
          style={{
            fontSize: "var(--font-size-xl)",
            fontWeight: 700,
            color: "var(--fg-primary)",
          }}
        >
          {formatCurrency(metrics.estimatedGenerationCost)}
        </div>
      </div>

      <div style={cardStyle}>
        <div
          style={{
            fontSize: "var(--font-size-xs)",
            color: "var(--fg-tertiary)",
            marginBottom: "0.25rem",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Tx Cost Est.
        </div>
        <div
          style={{
            fontSize: "var(--font-size-xl)",
            fontWeight: 700,
            color: "var(--fg-primary)",
          }}
        >
          {formatCurrency(metrics.estimatedTransactionCost)}
        </div>
      </div>

      <div style={cardStyle}>
        <div
          style={{
            fontSize: "var(--font-size-xs)",
            color: "var(--fg-tertiary)",
            marginBottom: "0.25rem",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Paid Requests
        </div>
        <div
          style={{
            fontSize: "var(--font-size-xl)",
            fontWeight: 700,
            color: "var(--fg-primary)",
          }}
        >
          {metrics.totalPaidRequests}
        </div>
      </div>

      <div style={cardStyle}>
        <div
          style={{
            fontSize: "var(--font-size-xs)",
            color: "var(--fg-tertiary)",
            marginBottom: "0.25rem",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Alerts
        </div>
        <div
          style={{
            fontSize: "var(--font-size-xl)",
            fontWeight: 700,
            color: "var(--fg-primary)",
          }}
        >
          {metrics.totalAlerts}
        </div>
      </div>

      <div style={cardStyle}>
        <div
          style={{
            fontSize: "var(--font-size-xs)",
            color: "var(--fg-tertiary)",
            marginBottom: "0.25rem",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Digests
        </div>
        <div
          style={{
            fontSize: "var(--font-size-xl)",
            fontWeight: 700,
            color: "var(--fg-primary)",
          }}
        >
          {metrics.totalDigests}
        </div>
      </div>

      <div style={cardStyle}>
        <div
          style={{
            fontSize: "var(--font-size-xs)",
            color: "var(--fg-tertiary)",
            marginBottom: "0.25rem",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Qualified Events
        </div>
        <div
          style={{
            fontSize: "var(--font-size-xl)",
            fontWeight: 700,
            color: "var(--fg-primary)",
          }}
        >
          {metrics.totalQualifiedEvents}
        </div>
      </div>
    </div>
  );
}
