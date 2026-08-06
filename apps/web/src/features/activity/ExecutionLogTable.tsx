// Execution log — responsive audit trail.
// Desktop renders a table; mobile stacks cards. Rows expand for full message + proof detail.
// Filters (search, status, action type) run client-side over the current page.

import { Search } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { StatusBadge, TimestampDisplay } from "../../components/data-primitives.tsx";
import { RoutingBadge } from "../../components/routing-badge.tsx";
import { flashbotsProtectStatusUrl, sepoliaTxUrl, truncateHash } from "../../lib/explorer.ts";

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
  /** private_mempool | public when logged (Phase 2). */
  routing?: string | null;
  routingLabel?: string | null;
  routingApplied?: string | null;
  routingRequested?: string | null;
  /** Flashbots Protect status URL when private route was requested (Phase 4). */
  protectStatusUrl?: string | null;
  /** Deterministic execution audit one-liner (Phase 4). */
  executionAuditSummary?: string | null;
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
    case "skipped":
      return "warning";
    case "failed":
      return "error";
    default:
      return "default";
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case "succeeded":
      return "Succeeded";
    case "started":
      return "Started";
    case "retrying":
      return "Retrying";
    case "skipped":
      return "Skipped";
    case "failed":
      return "Failed";
    default:
      return status;
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

function truncateId(id: string | null): string {
  if (!id) return "-";
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}...${id.slice(-4)}`;
}

const SKELETON_ROW_KEYS = ["sk-0", "sk-1", "sk-2", "sk-3"];

const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "succeeded", label: "Succeeded" },
  { id: "failed", label: "Failed" },
  { id: "started", label: "Started" },
  { id: "retrying", label: "Retrying" },
  { id: "skipped", label: "Skipped" },
] as const;

type StatusFilterId = (typeof STATUS_FILTERS)[number]["id"];

export function ExecutionLogTable({
  logs,
  isLoading = false,
  "data-testid": dataTestId = "execution-log-table",
}: ExecutionLogTableProps): React.ReactElement {
  const [statusFilter, setStatusFilter] = useState<StatusFilterId>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [query, setQuery] = useState("");

  const actionOptions = useMemo(() => {
    const actions = new Set<string>(logs.map((log) => log.actionType));
    return [...actions].sort();
  }, [logs]);

  const visibleLogs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((log) => {
      if (statusFilter !== "all" && log.status !== statusFilter) return false;
      if (actionFilter !== "all" && log.actionType !== actionFilter) return false;
      if (!q) return true;
      const haystack = [
        getActionTypeLabel(log.actionType),
        getEntityTypeLabel(log.entityType),
        log.entityId ?? "",
        log.message ?? "",
        log.txHash ?? "",
        log.keeperHubRunId ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [logs, statusFilter, actionFilter, query]);

  if (isLoading) {
    return (
      <div
        data-testid={dataTestId}
        aria-live="polite"
        aria-busy="true"
        aria-label="Loading execution logs"
        className="rounded-2xl border border-border bg-frame overflow-hidden"
      >
        {SKELETON_ROW_KEYS.map((rowKey) => (
          <div
            key={rowKey}
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

  return (
    <div data-testid={dataTestId}>
      {/* Filter toolbar */}
      <div className="flex flex-col gap-3 mb-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((option) => {
            const active = statusFilter === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setStatusFilter(option.id)}
                aria-pressed={active}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  active
                    ? "bg-foreground text-background"
                    : "border border-border bg-frame text-muted-foreground hover:text-foreground hover:border-border/60"
                }`}
              >
                {option.label}
              </button>
            );
          })}
          {actionOptions.length > 1 ? (
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              aria-label="Filter by action type"
              className="ml-1 h-8 rounded-lg border border-border bg-frame px-2 text-xs font-medium text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="all">All actions</option>
              {actionOptions.map((action) => (
                <option key={action} value={action}>
                  {getActionTypeLabel(action)}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        <label className="flex items-center gap-2 rounded-xl border border-border bg-frame px-3 py-2 lg:w-72">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search action, entity, message…"
            className="flex-1 min-w-0 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
            aria-label="Search execution logs"
          />
        </label>
      </div>

      {visibleLogs.length === 0 ? (
        <div className="rounded-2xl border border-border bg-frame p-6 text-center">
          <p className="text-sm text-muted-foreground">No execution logs match these filters.</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-2xl border border-border bg-frame">
            <table className="w-full text-sm text-left border-collapse">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Entity</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Message</th>
                  <th className="px-4 py-3 font-medium">Proof</th>
                  <th className="px-4 py-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {visibleLogs.map((log) => (
                  <tr key={log.id} className="border-b border-border/60 last:border-0 align-top">
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-foreground">
                          {getActionTypeLabel(log.actionType)}
                        </span>
                        {log.routing || log.routingLabel || log.routingRequested ? (
                          <RoutingBadge
                            routing={log.routing}
                            label={log.routingLabel}
                            routingApplied={log.routingApplied}
                            routingRequested={log.routingRequested}
                          />
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs text-muted-foreground">
                          {getEntityTypeLabel(log.entityType)}
                        </span>
                        {log.entityId ? (
                          <code
                            className="font-mono text-[11px] text-muted-foreground"
                            title={log.entityId}
                          >
                            {truncateId(log.entityId)}
                          </code>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        label={getStatusLabel(log.status)}
                        variant={getStatusVariant(log.status)}
                      />
                    </td>
                    <td className="px-4 py-3 max-w-[22rem]">
                      <LogMessage log={log} />
                    </td>
                    <td className="px-4 py-3">
                      <LogProof log={log} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <TimestampDisplay timestamp={log.createdAt} format="relative" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="flex flex-col gap-3 md:hidden">
            {visibleLogs.map((log) => (
              <div key={log.id} className="rounded-2xl border border-border bg-frame p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {getActionTypeLabel(log.actionType)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {getEntityTypeLabel(log.entityType)}
                      {log.entityId ? ` · ${truncateId(log.entityId)}` : ""}
                    </p>
                  </div>
                  <StatusBadge
                    label={getStatusLabel(log.status)}
                    variant={getStatusVariant(log.status)}
                  />
                </div>
                <p className="mt-2.5 text-xs text-muted-foreground leading-relaxed line-clamp-2">
                  {log.message ?? "No message"}
                </p>
                <div className="mt-3 pt-3 border-t border-border/50 flex flex-wrap items-center justify-between gap-2">
                  <LogProof log={log} />
                  <TimestampDisplay timestamp={log.createdAt} format="relative" />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function LogMessage({ log }: { log: ExecutionLogEntry }): React.ReactElement {
  const hasDetails = Boolean(log.message || log.executionAuditSummary || log.entityId);
  if (!hasDetails) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <details className="group">
      <summary className="cursor-pointer list-none">
        <span
          className="block text-xs text-muted-foreground leading-relaxed line-clamp-1 group-open:line-clamp-none"
          title={log.message ?? undefined}
        >
          {log.message ?? "—"}
        </span>
      </summary>
      {log.executionAuditSummary ? (
        <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
          {log.executionAuditSummary}
        </p>
      ) : null}
      {log.entityId ? (
        <code
          className="mt-2 block font-mono text-[11px] text-muted-foreground break-all"
          title={log.entityId}
        >
          entity {log.entityId}
        </code>
      ) : null}
    </details>
  );
}

function LogProof({ log }: { log: ExecutionLogEntry }): React.ReactElement {
  const hasProof = Boolean(
    log.txHash || log.keeperHubRunId || log.protectStatusUrl || log.executedViaKeeperHub,
  );
  if (!hasProof) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const protectUrl =
    log.protectStatusUrl ??
    (log.routing === "private_mempool" || log.routingRequested === "private_mempool"
      ? log.txHash
        ? flashbotsProtectStatusUrl(log.txHash)
        : null
      : null);

  return (
    <div className="flex flex-col gap-1 text-[11px]">
      {log.executedViaKeeperHub || log.keeperHubRunId ? (
        <span className="font-semibold tracking-wide uppercase text-accent">
          Executed via KeeperHub
        </span>
      ) : null}
      {log.txHash ? (
        <a
          href={log.explorerUrl ?? sepoliaTxUrl(log.txHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-muted-foreground hover:text-foreground transition-colors break-all"
          title={log.txHash}
        >
          tx {truncateHash(log.txHash, 8, 6)}
        </a>
      ) : null}
      {log.keeperHubRunId ? (
        <code className="font-mono text-muted-foreground" title={log.keeperHubRunId}>
          run {truncateId(log.keeperHubRunId)}
        </code>
      ) : null}
      {protectUrl ? (
        <a
          href={protectUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
          title="Flashbots Protect status (Sepolia)"
        >
          Protect status
        </a>
      ) : null}
    </div>
  );
}
