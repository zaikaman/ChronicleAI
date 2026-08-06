/**
 * Editorial execution audit timeline: preflight → submit → outcome.
 * Proof-first, calm chrome — no raw JSON dump.
 * Phase 2: expandable Run steps under outcome (KeeperHub /logs).
 */

import { useEffect, useState, type ReactElement } from "react";
import { StatusBadge, TimestampDisplay } from "../../components/data-primitives.tsx";
import { Surface } from "../../components/page-chrome.tsx";
import { RoutingBadge } from "../../components/routing-badge.tsx";
import {
  flashbotsProtectStatusUrl,
  formatGasUsed,
  truncateHash,
} from "../../lib/explorer.ts";
import { ProofMonoLink } from "./ProofMonoLink.tsx";
import type {
  DeskAuditGasNarrative,
  DeskAuditKhSimulate,
  DeskAuditKhSimulateLeg,
  DeskAuditKhSimulateStatus,
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

/**
 * Missing submit/outcome stages are storage defaults on the in-flight audit
 * snapshot. Keep that transient state informative instead of calling it
 * skipped in the user-facing timeline.
 */
function isAwaitingExecutionSubmission(audit: DeskExecutionAuditV1): boolean {
  const { preflight, submit, outcome } = audit.stages;
  return (
    preflight.status === "passed" &&
    submit.status === "skipped" &&
    outcome.status === "skipped" &&
    !submit.keeperHubRunId &&
    !submit.errorMessage?.trim() &&
    !outcome.errorMessage?.trim() &&
    outcome.txHashes.length === 0
  );
}

function submitVariant(
  status: DeskAuditSubmitStage["status"],
  awaitingSubmit = false,
): "default" | "success" | "warning" | "error" | "info" {
  if (awaitingSubmit) return "info";
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
  awaitingSubmit = false,
): "default" | "success" | "warning" | "error" | "info" {
  if (awaitingSubmit) return "info";
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

function policyPreflightLine(stage: DeskAuditPreflightStage): string {
  const bits: string[] = [];
  const policy = stage.policy;
  if (policy?.allow === false) bits.push("policy blocked");
  else if (policy?.simulatedHfAfter != null && Number.isFinite(policy.simulatedHfAfter)) {
    bits.push(`HF preflight ${policy.simulatedHfAfter.toFixed(2)}`);
  } else if (stage.status === "passed" || stage.status === "partial") {
    bits.push("HF preflight OK");
  }
  if (policy?.gasRegime) bits.push(`gas regime ${policy.gasRegime}`);
  if (policy?.reasonCodes?.length) {
    bits.push(policy.reasonCodes.slice(0, 2).join(", "));
  }
  if (stage.notes?.trim() && !stage.khSimulate) {
    bits.push(stage.notes.trim().slice(0, 80));
  }
  return bits.length > 0 ? bits.join(" · ") : stage.status;
}

/**
 * Layer A line — only when khSimulate was attempted or explicitly recorded.
 * Label: "KeeperHub dry-run" (never "KeeperHub simulation" for HF-only).
 * Aggregate counts alone can hide waived raw reverts — per-leg list is required.
 */
function khDryRunLine(stage: DeskAuditPreflightStage): string | null {
  const sim = stage.khSimulate;
  if (!sim) return null;
  if (!sim.attempted && sim.status === "skipped") {
    return sim.errorMessage?.trim()
      ? `KeeperHub dry-run: skipped · ${sim.errorMessage.trim().slice(0, 60)}`
      : "KeeperHub dry-run: skipped";
  }
  const bits: string[] = [`KeeperHub dry-run: ${sim.status}`];
  if (
    typeof sim.legCount === "number" &&
    sim.legCount > 1 &&
    typeof sim.passedLegs === "number"
  ) {
    bits.push(`${sim.passedLegs}/${sim.legCount} legs`);
  }
  const waivedCount = (sim.legs ?? []).filter((l) => l.waived === true).length;
  if (waivedCount > 0) {
    bits.push(`${waivedCount} waived`);
  }
  if (sim.gasEstimate) {
    const gas = formatGasUsed(sim.gasEstimate);
    bits.push(gas ? `est. ${gas.replace(/ gas$/, "")} gas` : `est. ${sim.gasEstimate} gas`);
  }
  if (sim.wouldRevert === true) bits.push("wouldRevert true");
  else if (sim.wouldRevert === false) bits.push("wouldRevert false");
  if (sim.revertReason?.trim()) bits.push(sim.revertReason.trim().slice(0, 60));
  else if (sim.errorMessage?.trim() && sim.status !== "passed") {
    bits.push(sim.errorMessage.trim().slice(0, 60));
  }
  return bits.join(" · ");
}

function khSimulateStatusVariant(
  status: DeskAuditKhSimulateStatus,
): "default" | "success" | "warning" | "error" | "info" {
  switch (status) {
    case "passed":
      return "success";
    case "failed":
      return "error";
    case "error":
      return "error";
    case "skipped":
      return "default";
    default:
      return "default";
  }
}

/** Humanize machine waiveReason codes for editorial audit copy. */
function formatWaiveReason(reason: string | undefined): string | null {
  if (!reason?.trim()) return null;
  return reason
    .trim()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ");
}

function khSimulateLegDetail(leg: DeskAuditKhSimulateLeg): string {
  const bits: string[] = [];
  if (leg.kind?.trim()) bits.push(leg.kind.trim());
  if (leg.wouldRevert === true) bits.push("wouldRevert true");
  else if (leg.wouldRevert === false) bits.push("wouldRevert false");
  if (leg.gasEstimate) {
    const gas = formatGasUsed(leg.gasEstimate);
    bits.push(gas ? `est. ${gas.replace(/ gas$/, "")}` : `est. ${leg.gasEstimate}`);
  }
  if (leg.waived === true) {
    const waive = formatWaiveReason(leg.waiveReason);
    bits.push(waive ? `waived · ${waive}` : "waived");
  }
  if (leg.revertReason?.trim()) bits.push(leg.revertReason.trim().slice(0, 80));
  else if (leg.errorMessage?.trim() && leg.status !== "passed") {
    bits.push(leg.errorMessage.trim().slice(0, 80));
  }
  return bits.join(" · ");
}

/**
 * Per-leg KeeperHub dry-run evidence.
 * Always renders when legs[] is present — aggregate passedLegs can count
 * waived reverts as pass, so raw wouldRevert must stay visible here.
 */
function KhSimulateLegsList({
  sim,
}: {
  sim: DeskAuditKhSimulate;
}): ReactElement | null {
  const legs = sim.legs;
  if (!legs || legs.length === 0) return null;

  return (
    <ul
      className="mt-1.5 flex flex-col gap-1.5 list-none m-0 p-0 w-full min-w-0"
      data-testid="execution-audit-kh-dry-run-legs"
      aria-label="KeeperHub dry-run legs"
    >
      {legs.map((leg, i) => {
        const detail = khSimulateLegDetail(leg);
        // Waived raw-reverts are soft-pass for aggregate but still evidence —
        // warn visually so they cannot hide behind a green aggregate badge.
        const statusVariant =
          leg.waived === true && leg.wouldRevert === true
            ? "warning"
            : khSimulateStatusVariant(leg.status);
        const statusLabel =
          leg.waived === true && leg.status === "failed"
            ? "waived"
            : leg.status;

        return (
          <li
            key={`${leg.id}-${i}`}
            className="rounded-md border border-border/50 bg-muted/20 px-2.5 py-2 flex flex-col gap-1 min-w-0"
            data-testid={`execution-audit-kh-dry-run-leg-${i}`}
            data-leg-id={leg.id}
            data-waived={leg.waived === true ? "true" : "false"}
            data-would-revert={
              leg.wouldRevert === true
                ? "true"
                : leg.wouldRevert === false
                  ? "false"
                  : undefined
            }
          >
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <span className="text-xs font-medium text-foreground truncate max-w-[14rem]">
                {leg.label?.trim() || leg.id}
              </span>
              <StatusBadge
                label={statusLabel}
                variant={statusVariant}
                data-testid={`execution-audit-kh-dry-run-leg-status-${i}`}
              />
              {leg.waived === true && leg.status !== "failed" ? (
                <StatusBadge
                  label="waived"
                  variant="warning"
                  data-testid={`execution-audit-kh-dry-run-leg-waived-${i}`}
                />
              ) : null}
            </div>
            {detail ? (
              <p
                className="text-[11px] text-muted-foreground leading-relaxed text-pretty font-mono"
                data-testid={`execution-audit-kh-dry-run-leg-detail-${i}`}
              >
                {detail}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function submitDetail(
  stage: DeskAuditSubmitStage,
  awaitingSubmit = false,
): string {
  const bits: string[] = [];
  if (stage.keeperHubRunId) {
    bits.push(`run ${truncateHash(stage.keeperHubRunId, 8, 4)}`);
  } else if (awaitingSubmit) {
    bits.push("Awaiting KeeperHub submission");
  } else {
    bits.push(stage.status);
  }
  if (stage.workflowAction) bits.push(stage.workflowAction);
  if (stage.errorMessage?.trim()) bits.push(stage.errorMessage.trim().slice(0, 60));
  return bits.join(" · ");
}

function outcomeDetail(
  stage: DeskAuditOutcomeStage,
  awaitingSubmit = false,
): string {
  const bits: string[] = [];
  if (awaitingSubmit) bits.push("Awaiting execution outcome");
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

function GasNarrativeRow({
  gasNarrative,
  gasEstimateVsUsed,
  khSimulateGasEstimate,
  gasUsed,
  gasRegime,
}: {
  gasNarrative?: DeskAuditGasNarrative | null;
  gasEstimateVsUsed?: { estimate?: string | null; used?: string | null } | null;
  khSimulateGasEstimate?: string | null;
  gasUsed?: string | null;
  gasRegime?: string | null;
}): ReactElement | null {
  const estRaw =
    gasNarrative?.estimate ??
    gasEstimateVsUsed?.estimate ??
    khSimulateGasEstimate ??
    null;
  const usedRaw =
    gasNarrative?.used ?? gasEstimateVsUsed?.used ?? gasUsed ?? null;
  const regime = gasNarrative?.regime ?? gasRegime ?? null;

  const estFormatted = estRaw
    ? formatGasUsed(estRaw)?.replace(/ gas$/, "")
    : null;
  const usedFormatted = usedRaw
    ? formatGasUsed(usedRaw)?.replace(/ gas$/, "")
    : null;

  if (!estFormatted && !usedFormatted && !regime) return null;

  const parts: string[] = [];
  if (estFormatted) parts.push(`estimate ${estFormatted}`);
  if (usedFormatted) parts.push(`used ${usedFormatted}`);
  if (regime) parts.push(`regime ${regime}`);

  return (
    <div
      className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground font-mono bg-muted/20 px-2.5 py-1 rounded border border-border/40"
      data-testid="execution-audit-gas-narrative"
    >
      <span className="font-semibold text-foreground">Gas</span>
      <span>—</span>
      <span>{parts.join(" · ")}</span>
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
  const khDryRun = khDryRunLine(preflight);
  const awaitingSubmit = isAwaitingExecutionSubmission(audit);

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
          detail={policyPreflightLine(preflight)}
          at={preflight.at}
          testId="execution-audit-preflight"
          extra={
            khDryRun || preflight.khSimulate?.legs?.length ? (
              <div className="flex flex-col gap-1 mt-0.5 w-full min-w-0">
                {khDryRun ? (
                  <p
                    className="text-xs text-muted-foreground leading-relaxed text-pretty"
                    data-testid="execution-audit-kh-dry-run"
                  >
                    {khDryRun}
                  </p>
                ) : null}
                {preflight.khSimulate ? (
                  <KhSimulateLegsList sim={preflight.khSimulate} />
                ) : null}
                {khDryRun ? (
                  <p
                    className="text-[11px] text-muted-foreground/80 leading-relaxed text-pretty"
                    data-testid="execution-audit-kh-dry-run-caveat"
                  >
                    Dry-run uses org wallet from-path; Safe/msg.sender caveats may apply.
                  </p>
                ) : null}
              </div>
            ) : null
          }
        />

        <StageRow
          step={2}
          title="Submit"
          statusLabel={awaitingSubmit ? "Pending" : submit.status}
          statusVariant={submitVariant(submit.status, awaitingSubmit)}
          detail={submitDetail(submit, awaitingSubmit)}
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
          statusLabel={awaitingSubmit ? "Pending" : outcome.status}
          statusVariant={outcomeVariant(outcome.status, awaitingSubmit)}
          detail={outcomeDetail(outcome, awaitingSubmit)}
          at={outcome.at}
          testId="execution-audit-outcome"
          extra={
            <div className="flex flex-col gap-1.5 mt-0.5 w-full min-w-0">
              {outcome.txHashes.length > 0
                ? outcome.txHashes.map((hash, i) => (
                    <div
                      key={hash}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1"
                    >
                      <ProofMonoLink
                        value={hash}
                        asTx
                        href={outcome.explorerUrls?.[i] || undefined}
                        data-testid={`execution-audit-tx-${i}`}
                      />
                      {submit.routing === "private_mempool"
                        ? (() => {
                            const protectUrl = flashbotsProtectStatusUrl(hash);
                            if (!protectUrl) return null;
                            return (
                              <a
                                href={protectUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
                                data-testid={`execution-audit-protect-${i}`}
                                title="Flashbots Protect status (Sepolia)"
                              >
                                Protect →
                              </a>
                            );
                          })()
                        : null}
                    </div>
                  ))
                : null}
              <GasNarrativeRow
                gasNarrative={outcome.gasNarrative}
                gasEstimateVsUsed={outcome.gasEstimateVsUsed}
                khSimulateGasEstimate={preflight.khSimulate?.gasEstimate}
                gasUsed={outcome.gasUsed}
                gasRegime={preflight.policy?.gasRegime}
              />
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
