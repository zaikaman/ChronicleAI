// Execution log table component
// Displays audit logs with action type, status, entity reference, timestamp, and retry visibility

import type React from "react";
import { StatusBadge, TimestampDisplay } from "../../components/data-primitives.tsx";

interface ExecutionLogEntry {
  id: string;
  actionType: string;
  entityType: string | null;
  entityId: string | null;
  status: string;
  message: string | null;
  createdAt: string;
}

interface ExecutionLogTableProps {
  logs: ExecutionLogEntry[];
  isLoading?: boolean;
  "data-testid"?: string;
}

function getActionTypeLabel(actionType: string): string {
  const labels: Record<string, string> = {
    monitor: "Monitor",
    generate_alert: "Generate Alert",
    publish_alert: "Publish Alert",
    generate_digest: "Generate Digest",
    publish_digest: "Publish Digest",
    payment: "Payment",
    treasury_check: "Treasury Check",
    operator_notification: "Notification",
    registry_write: "Registry Write",
    payout: "Payout",
  };
  return labels[actionType] ?? actionType;
}

function getStatusVariant(
  status: string,
): "default" | "success" | "warning" | "error" | "info" {
  switch (status) {
    case "succeeded":
      return "success";
    case "started":
      return "info";
    case "retrying":
      return "warning";
    case "failed":
      return "error";
    default:
      return "default";
  }
}

function getEntityTypeLabel(entityType: string | null): string {
  const labels: Record<string, string> = {
    monitored_event: "Event",
    public_alert: "Alert",
    daily_digest: "Digest",
    payment_record: "Payment",
    treasury_snapshot: "Treasury",
    payout_record: "Payout",
    sponsored_watch: "Watch",
  };
  return entityType ? (labels[entityType] ?? entityType) : "-";
}

function truncateEntityId(id: string | null): string {
  if (!id) return "-";
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}...${id.slice(-4)}`;
}

export function ExecutionLogTable({
  logs,
  isLoading = false,
  "data-testid": dataTestId = "execution-log-table",
}: ExecutionLogTableProps): React.ReactElement {
  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: "2rem" }}>
        <p style={{ color: "var(--fg-tertiary)", fontSize: "var(--font-size-sm)" }}>
          Loading execution logs...
        </p>
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div
        style={{
          padding: "1.5rem",
          textAlign: "center",
          background: "var(--bg-glass)",
          borderRadius: "8px",
          border: "1px solid var(--border-primary)",
        }}
      >
        <p style={{ color: "var(--fg-tertiary)", margin: 0, fontSize: "var(--font-size-sm)" }}>
          No execution logs recorded yet.
        </p>
      </div>
    );
  }

  const tableHeaderStyle: React.CSSProperties = {
    padding: "0.75rem 1rem",
    fontSize: "var(--font-size-xs)",
    color: "var(--fg-tertiary)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    textAlign: "left",
    borderBottom: "1px solid var(--border-primary)",
    fontWeight: 600,
  };

  const tableCellStyle: React.CSSProperties = {
    padding: "0.75rem 1rem",
    fontSize: "var(--font-size-sm)",
    color: "var(--fg-secondary)",
    borderBottom: "1px solid var(--border-primary)",
    verticalAlign: "middle",
  };

  return (
    <div data-testid={dataTestId}>
      <div
        style={{
          overflowX: "auto",
          borderRadius: "12px",
          border: "1px solid var(--border-primary)",
          background: "var(--bg-glass)",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "700px" }}>
          <thead>
            <tr>
              <th style={tableHeaderStyle}>Action</th>
              <th style={tableHeaderStyle}>Entity</th>
              <th style={tableHeaderStyle}>Status</th>
              <th style={tableHeaderStyle}>Message</th>
              <th style={tableHeaderStyle}>Time</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr
                key={log.id}
                style={{
                  transition: "background 0.1s ease",
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.02)";
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = "";
                }}
              >
                <td style={tableCellStyle}>
                  <span style={{ fontWeight: 500, color: "var(--fg-primary)" }}>
                    {getActionTypeLabel(log.actionType)}
                  </span>
                </td>
                <td style={tableCellStyle}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
                    <span style={{ fontSize: "var(--font-size-xs)", color: "var(--fg-tertiary)" }}>
                      {getEntityTypeLabel(log.entityType)}
                    </span>
                    {log.entityId && (
                      <code
                        style={{
                          fontSize: "var(--font-size-xs)",
                          fontFamily: "var(--font-mono)",
                          color: "var(--fg-tertiary)",
                        }}
                      >
                        {truncateEntityId(log.entityId)}
                      </code>
                    )}
                  </div>
                </td>
                <td style={tableCellStyle}>
                  <StatusBadge
                    label={log.status}
                    variant={getStatusVariant(log.status)}
                  />
                </td>
                <td style={{ ...tableCellStyle, maxWidth: "300px", overflow: "hidden", textOverflow: "ellipsis" }}>
                  <span style={{ fontSize: "var(--font-size-xs)" }}>
                    {log.message ?? "-"}
                  </span>
                </td>
                <td style={{ ...tableCellStyle, whiteSpace: "nowrap" }}>
                  <TimestampDisplay timestamp={log.createdAt} format="relative" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
