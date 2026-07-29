/**
 * Editorial execution audit timeline: preflight → submit → outcome.
 * Proof-first, calm chrome — no raw JSON dump.
 * Phase 2: expandable Run steps under outcome (KeeperHub /logs).
 */

import { useEffect, useState, type ReactElement } from "react";
import { StatusBadge, TimestampDisplay } from "../../components/data-primitives.tsx";
import { Surface } from "../../components/page-chrome.tsx";
import { RoutingBadge } from "../../components/routing-badge.tsx";
import { formatGasUsed, truncateHash } from "../../lib/explorer.ts";
import { ProofMonoLink } from "./ProofMonoLink.tsx";
import type {
  DeskAuditOutcomeStage,
  DeskAuditPreflightStage,
  DeskAuditRunNode,
  DeskAuditSubmitStage,
  DeskExecutionAuditV1,
} from "./types.ts";

function preflightVariant(
  status: DeskAuditPreflightStage["status"],
): "default" | "success" | "warning" | "error" | "info" {
  switch (status) {
    case "passed":
      return "success";
    case "failed":
      return "error";
    case "partial":
      return "warning";
    default:
      return "default";
  }
}

function submitVariant(
  status: DeskAuditSubmitStage["status"],
): "default" | "success" | "warning" | "error" | "info" {
  switch (status) {
    case "started":
      return "info";
    case "failed":
      return "error";
    default:
      return "default";
  }
}

function outcomeVariant(
  status: DeskAuditOutcomeStage["status"],
): "default" | "success" | "warning" | "error" | "info" {
  switch (status) {
    case "filled":
      return "success";
    case "failed":
      return "error";
    case "timeout":
      return "warning";
    default:
      return "default";
  }
}

function preflightDetail(stage: DeskAuditPreflightStage): string {
  const bits: string[] = [];
  const policy = stage.policy;
  if (policy?.allow === false) bits.push("policy blocked");
  else if (policy?.simulatedHfAfter != null && Number.isFinite(policy.simulatedHfAfter)) {
    bits.push(`HF preflight ${policy.simulatedHfAfter.toFixed(2)}`);
  } else if (stage.status === "passed") {
    bits.push("HF preflight OK");
  }
  if (policy?.gasRegime) bits.push(`gas regime ${policy.gasRegime}`);
  if (policy?.reasonCodes?.length) {
    bits.push(policy.reasonCodes.slice(0, 2).join(", "));
  }
  if (stage.notes?.trim()) bits.push(stage.notes.trim().slice(0, 80));
  return bits.length > 0 ? bits.join(" · ") : stage.status;
}

function submitDetail(stage: DeskAuditSubmitStage): string {
  const bits: string[] = [];
  if (stage.keeperHubRunId) {
    bits.push(`run ${truncateHash(stage.keeperHubRunId, 8, 4)}`);
  } else {
    bits.push(stage.status);
  }
  if (stage.workflowAction) bits.push(stage.workflowAction);
  if (stage.errorMessage?.trim()) bits.push(stage.errorMessage.trim().slice(0, 60));
  return bits.join(" · ");
}

function outcomeDetail(stage: DeskAuditOutcomeStage): string {
  const bits: string[] = [];
  const primary = stage.txHashes[0];
  if (primary) bits.push(truncateHash(primary, 8, 4));
  const gas = formatGasUsed(stage.gasUsed);
  if (gas) bits.push(gas);
  if (stage.errorMessage?.trim() && stage.status !== "filled") {
    bits.push(stage.errorMessage.trim().slice(0, 60));
  }
  if (bits.length === 0) bits.push(stage.status);
  return bits.join(" · ");
}

function nodeStatusVariant(
  status: string,
): "default" | "success" | "warning" | "error" | "info" {
  const s = status.toLowerCase();
  if (s === "success" || s === "succeeded" || s === "completed") return "success";
  if (s === "error" || s === "failed") return "error";
  if (s === "running" || s === "pending") return "info";
  if (s === "cancelled" || s === "canceled") return "warning";
  return "default";
}

function formatDurationMs(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}

function nodeGasLabel(node: DeskAuditRunNode): string | null {
  // Prefer units (plan: gas units for display); fall back to gasUsed.
  return formatGasUsed(node.gasUsedUnits ?? node.gasUsed);
}

function nodeDisplayName(node: DeskAuditRunNode): string {
  return node.nodeName?.trim() || node.nodeType?.trim() || node.nodeId;
}

/**
 * Expandable KeeperHub run steps under the outcome stage.
 * Default collapsed on mobile; expanded on desktop when ≤ 6 nodes.
 */
function RunStepsList({
  nodes,
  logsFetched,
  logsFetchError,
}: {
  nodes: DeskAuditRunNode[];
  logsFetched?: boolean;
  logsFetchError?: string | null;
}): ReactElement | null {
  const count = nodes.length;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 768px)");
    const apply = () => {
      // Expanded on desktop detail if ≤ 6 nodes (plan §2.3).
      setOpen(mq.matches && count > 0 && count <= 6);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [count]);

  if (count === 0) {
    if (logsFetched === false && logsFetchError) {
      return (
        <p
          className="mt-1 text-xs text-muted-foreground"
          data-testid="execution-audit-run-steps-error"
        >
          Run steps unavailable · {logsFetchError.slice(0, 80)}
        </p>
      );
    }
    return null;
  }

  return (
    <div className="mt-2 w-full min-w-0" data-testid="execution-audit-run-steps">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-left text-xs font-medium text-foreground hover:bg-muted/50 transition-colors"
        aria-expanded={open}
        aria-controls="execution-audit-run-steps-panel"
        data-testid="execution-audit-run-steps-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        <span>
          Run steps · {count} node{count === 1 ? "" : "s"}
        </span>
        <span className="text-muted-foreground tabular-nums" aria-hidden>
          {open ? "−" : "+"}
        </span>
      </button>

      {open ? (
        <div
          id="execution-audit-run-steps-panel"
          className="mt-2 overflow-x-auto rounded-md border border-border/50"
          data-testid="execution-audit-run-steps-panel"
        >
          <table className="w-full min-w-[28rem] text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-border/50 text-muted-foreground">
                <th className="px-3 py-2 font-medium">Node</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Duration</th>
                <th className="px-3 py-2 font-medium">Gas</th>
                <th className="px-3 py-2 font-medium">Tx</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((node, i) => {
                const duration = formatDurationMs(node.durationMs);
                const gas = nodeGasLabel(node);
                return (
                  <tr
                    key={`${node.nodeId}-${i}`}
                    className="border-b border-border/40 last:border-0"
                    data-testid={`execution-audit-run-node-${i}`}
                  >
                    <td className="px-3 py-2 text-foreground max-w-[10rem] truncate">
                      {nodeDisplayName(node)}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge
                        label={node.status}
                        variant={nodeStatusVariant(node.status)}
                      />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground tabular-nums">
                      {duration ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground tabular-nums">
                      {gas ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      {node.txHash ? (
                        <ProofMonoLink
                          value={node.txHash}
                          asTx
                          href={node.explorerUrl || undefined}
                          data-testid={`execution-audit-run-node-tx-${i}`}
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

interface StageRowProps {
  step: number;
  title: string;
  statusLabel: string;
  statusVariant: "default" | "success" | "warning" | "error" | "info";
  detail: string;
  at: string;
  extra?: ReactElement | null;
  testId: string;
}

function StageRow({
  step,
  title,
  statusLabel,
  statusVariant,
  detail,
  at,
  extra,
  testId,
}: StageRowProps): ReactElement {
  return (
    <Surface
      as="li"
      className="px-4 py-3 flex flex-wrap items-start gap-3"
      data-testid={testId}
    >
      <span
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground tabular-nums shrink-0"
        aria-hidden
      >
        {step}
      </span>
      <div className="min-w-0 flex-1 flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <StatusBadge
            label={statusLabel}
            variant={statusVariant}
            data-testid={`${testId}-status`}
          />
          <TimestampDisplay timestamp={at} />
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed text-pretty">{detail}</p>
        {extra}
      </div>
    </Surface>
  );
}

export interface ExecutionAuditTimelineProps {
  audit: DeskExecutionAuditV1;
}

export function ExecutionAuditTimeline({
  audit,
}: ExecutionAuditTimelineProps): ReactElement {
  const { preflight, submit, outcome } = audit.stages;

  return (
    <div data-testid="execution-audit-timeline">
      {audit.summaryLine ? (
        <p
          className="mb-3 text-sm text-muted-foreground leading-relaxed max-w-2xl text-pretty"
          data-testid="execution-audit-summary"
        >
          {audit.summaryLine}
        </p>
      ) : null}

      <ol className="flex flex-col gap-2 list-none m-0 p-0" aria-label="Execution audit stages">
        <StageRow
          step={1}
          title="Preflight"
          statusLabel={preflight.status}
          statusVariant={preflightVariant(preflight.status)}
          detail={preflightDetail(preflight)}
          at={preflight.at}
          testId="execution-audit-preflight"
        />

        <StageRow
          step={2}
          title="Submit"
          statusLabel={submit.status}
          statusVariant={submitVariant(submit.status)}
          detail={submitDetail(submit)}
          at={submit.at}
          testId="execution-audit-submit"
          extra={
            <div className="flex flex-wrap items-center gap-2 mt-0.5">
              {submit.routing ? (
                <RoutingBadge
                  routing={submit.routing}
                  routingApplied={
                    submit.routing === "private_mempool" ? "unknown" : submit.routing
                  }
                  data-testid="execution-audit-routing"
                />
              ) : null}
              {submit.keeperHubRunId ? (
                <ProofMonoLink
                  value={submit.keeperHubRunId}
                  data-testid="execution-audit-run-id"
                />
              ) : null}
            </div>
          }
        />

        <StageRow
          step={3}
          title="Outcome"
          statusLabel={outcome.status}
          statusVariant={outcomeVariant(outcome.status)}
          detail={outcomeDetail(outcome)}
          at={outcome.at}
          testId="execution-audit-outcome"
          extra={
            <div className="flex flex-col gap-1 mt-0.5 w-full min-w-0">
              {outcome.txHashes.length > 0
                ? outcome.txHashes.map((hash, i) => (
                    <ProofMonoLink
                      key={hash}
                      value={hash}
                      asTx
                      href={outcome.explorerUrls?.[i] || undefined}
                      data-testid={`execution-audit-tx-${i}`}
                    />
                  ))
                : null}
              <RunStepsList
                nodes={outcome.runNodes ?? []}
                logsFetched={outcome.logsFetched}
                logsFetchError={outcome.logsFetchError}
              />
            </div>
          }
        />
      </ol>
    </div>
  );
}

/** Legacy / missing audit — calm one-liner, never fabricate stages. */
export function ExecutionAuditMissing(): ReactElement {
  return (
    <Surface className="p-5" data-testid="execution-audit-missing">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Execution audit not recorded for this ticket.
      </p>
    </Surface>
  );
}
