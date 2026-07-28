// Execution log table component
// Displays audit logs with action type, status, entity reference, timestamp, and retry visibility

import type React from "react";
import { StatusBadge, TimestampDisplay } from "../../components/data-primitives.tsx";
import { sepoliaTxUrl, truncateHash } from "../../lib/explorer.ts";

interface ExecutionLogEntry {
  id: string;
  actionType: string;
  entityType: string | null;
  entityId: string | null;
  status: string;
  message: string | null;
  createdAt: string;
  keeperHubRunId?: string;
  txHash?: string;
  explorerUrl?: string;
  executedViaKeeperHub?: boolean;
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
    treasury_audit: "Utility Audit",
    notification: "Notification",
    registry_write: "Registry Write",
    payout: "Payout",
    cctp_rebalance: "CCTP Rebalance",
    desk_agent: "Desk Agent",
    desk_intent: "Desk Intent",
    desk_workflow: "Desk Workflow",
    sponsored_watch: "Sponsored Watch",
    premium_receipt: "Premium Receipt",
    desk_event_microtrade: "Event Microtrade",
  };
  return labels[actionType] ?? actionType;
}

function getStatusVariant(status: string): "default" | "success" | "warning" | "error" | "info" {
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
    cctp_rebalance_transfer: "CCTP",
    desk: "Desk",
    desk_agent_run: "Agent Run",
    desk_intent: "Intent",
    desk_workflow: "Workflow",
    desk_capital_move: "Capital Move",
    desk_event_microtrade: "Event Microtrade",
    keeperhub_workflow: "KH Workflow",
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
      <div
        data-testid={dataTestId}
        role="status"
        aria-busy="true"
        aria-label="Loading execution logs"
        className="rounded-2xl border border-border bg-frame overflow-hidden"
      >
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="px-4 py-3.5 border-b border-border/50 last:border-0 flex items-center gap-4"
          >
            <div className="skeleton-bone h-3.5 w-24" />
            <div className="skeleton-bone h-3.5 flex-1 max-w-[40%]" />
            <div className="skeleton-bone skeleton-bone--pill h-5 w-16" />
            <div className="skeleton-bone h-3 w-20 hidden sm:block" />
          </div>
        ))}
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
              <th style={tableHeaderStyle}>KeeperHub</th>
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
                  <StatusBadge label={log.status} variant={getStatusVariant(log.status)} />
                </td>
                <td style={tableCellStyle}>
                  {log.executedViaKeeperHub || log.keeperHubRunId ? (
                    <div
                      style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}
                      data-testid="log-executed-via-keeperhub"
                    >
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          color: "var(--accent-primary, #7dd3fc)",
                        }}
                      >
                        Executed via KeeperHub
                      </span>
                      {log.keeperHubRunId ? (
                        <code
                          style={{
                            fontSize: "var(--font-size-xs)",
                            fontFamily: "var(--font-mono)",
                            color: "var(--fg-tertiary)",
                          }}
                          title={log.keeperHubRunId}
                        >
                          {truncateEntityId(log.keeperHubRunId)}
                        </code>
                      ) : null}
                      {log.txHash ? (
                        <a
                          href={log.explorerUrl ?? sepoliaTxUrl(log.txHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontSize: "var(--font-size-xs)",
                            fontFamily: "var(--font-mono)",
                            color: "var(--accent-primary, #7dd3fc)",
                          }}
                          title={log.txHash}
                        >
                          {truncateHash(log.txHash)}
                        </a>
                      ) : null}
                    </div>
                  ) : (
                    <span style={{ color: "var(--fg-tertiary)", fontSize: "var(--font-size-xs)" }}>
                      —
                    </span>
                  )}
                </td>
                <td
                  style={{
                    ...tableCellStyle,
                    maxWidth: "300px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  <span style={{ fontSize: "var(--font-size-xs)" }}>{log.message ?? "-"}</span>
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
