// Treasury status panel component
// Displays treasury health with healthy, warning, and critical visual states

import type React from "react";

export interface TreasuryStatusData {
  availableBalance: number;
  safetyBuffer: number;
  status: string;
}

interface TreasuryStatusPanelProps {
  treasury: TreasuryStatusData | null;
  isLoading?: boolean;
  "data-testid"?: string;
}

function getStatusConfig(status: string): {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  icon: string;
} {
  switch (status) {
    case "healthy":
      return {
        label: "Healthy",
        color: "var(--accent-success)",
        bgColor: "rgba(34, 197, 94, 0.1)",
        borderColor: "rgba(34, 197, 94, 0.2)",
        icon: "\u2713",
      };
    case "warning":
      return {
        label: "Warning",
        color: "var(--accent-warning)",
        bgColor: "rgba(245, 158, 11, 0.1)",
        borderColor: "rgba(245, 158, 11, 0.2)",
        icon: "\u26A0",
      };
    case "critical":
      return {
        label: "Critical",
        color: "var(--accent-error)",
        bgColor: "rgba(239, 68, 68, 0.1)",
        borderColor: "rgba(239, 68, 68, 0.2)",
        icon: "\u2716",
      };
    default:
      return {
        label: "Unknown",
        color: "var(--fg-tertiary)",
        bgColor: "var(--bg-glass)",
        borderColor: "var(--border-primary)",
        icon: "?",
      };
  }
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function TreasuryStatusPanel({
  treasury,
  isLoading = false,
  "data-testid": dataTestId = "treasury-status-panel",
}: TreasuryStatusPanelProps): React.ReactElement {
  if (isLoading) {
    return (
      <div
        style={{
          padding: "1.5rem",
          textAlign: "center",
          background: "var(--bg-glass)",
          borderRadius: "12px",
          border: "1px solid var(--border-primary)",
        }}
      >
        <p style={{ color: "var(--fg-tertiary)", fontSize: "var(--font-size-sm)" }}>
          Loading treasury status...
        </p>
      </div>
    );
  }

  if (!treasury) {
    return (
      <div
        style={{
          padding: "1.5rem",
          textAlign: "center",
          background: "var(--bg-glass)",
          borderRadius: "12px",
          border: "1px solid var(--border-primary)",
        }}
      >
        <p style={{ color: "var(--fg-tertiary)", fontSize: "var(--font-size-sm)" }}>
          No treasury data available.
        </p>
      </div>
    );
  }

  const statusConfig = getStatusConfig(treasury.status);
  const bufferRatio = treasury.safetyBuffer > 0
    ? (treasury.availableBalance / treasury.safetyBuffer) * 100
    : 0;

  return (
    <div
      data-testid={dataTestId}
      style={{
        background: statusConfig.bgColor,
        border: `1px solid ${statusConfig.borderColor}`,
        borderRadius: "12px",
        padding: "1.5rem",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem",
        }}
      >
        <h3
          style={{
            fontSize: "var(--font-size-md)",
            fontWeight: 600,
            color: "var(--fg-primary)",
            margin: 0,
          }}
        >
          Treasury Status
        </h3>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.25rem 0.75rem",
            borderRadius: "999px",
            background: statusConfig.bgColor,
            border: `1px solid ${statusConfig.borderColor}`,
          }}
        >
          <span style={{ color: statusConfig.color, fontWeight: 700 }}>
            {statusConfig.icon}
          </span>
          <span
            style={{
              color: statusConfig.color,
              fontSize: "var(--font-size-sm)",
              fontWeight: 600,
            }}
          >
            {statusConfig.label}
          </span>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "1rem",
          marginBottom: "1rem",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "var(--font-size-xs)",
              color: "var(--fg-tertiary)",
              marginBottom: "0.25rem",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Available Balance
          </div>
          <div
            style={{
              fontSize: "var(--font-size-xl)",
              fontWeight: 700,
              color: "var(--fg-primary)",
            }}
          >
            {formatCurrency(treasury.availableBalance)}
          </div>
        </div>
        <div>
          <div
            style={{
              fontSize: "var(--font-size-xs)",
              color: "var(--fg-tertiary)",
              marginBottom: "0.25rem",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Safety Buffer
          </div>
          <div
            style={{
              fontSize: "var(--font-size-xl)",
              fontWeight: 700,
              color: "var(--fg-primary)",
            }}
          >
            {formatCurrency(treasury.safetyBuffer)}
          </div>
        </div>
      </div>

      {/* Buffer progress bar */}
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "var(--font-size-xs)",
            color: "var(--fg-tertiary)",
            marginBottom: "0.25rem",
          }}
        >
          <span>Buffer utilization</span>
          <span>{bufferRatio.toFixed(0)}%</span>
        </div>
        <div
          style={{
            height: "6px",
            background: "var(--bg-tertiary)",
            borderRadius: "3px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${Math.min(bufferRatio, 100)}%`,
              background:
                treasury.status === "healthy"
                  ? "var(--accent-success)"
                  : treasury.status === "warning"
                    ? "var(--accent-warning)"
                    : "var(--accent-error)",
              borderRadius: "3px",
              transition: "width 0.3s ease",
            }}
          />
        </div>
      </div>
    </div>
  );
}
