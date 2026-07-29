/**
 * Editorial execution audit timeline: preflight → submit → outcome.
 * Proof-first, calm chrome — no raw JSON dump.
 */

import type { ReactElement } from "react";
import { StatusBadge, TimestampDisplay } from "../../components/data-primitives.tsx";
import { Surface } from "../../components/page-chrome.tsx";
import { RoutingBadge } from "../../components/routing-badge.tsx";
import { formatGasUsed, truncateHash } from "../../lib/explorer.ts";
import { ProofMonoLink } from "./ProofMonoLink.tsx";
import type {
  DeskAuditOutcomeStage,
  DeskAuditPreflightStage,
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
            outcome.txHashes.length > 0 ? (
              <div className="flex flex-col gap-1 mt-0.5">
                {outcome.txHashes.map((hash, i) => (
                  <ProofMonoLink
                    key={hash}
                    value={hash}
                    asTx
                    href={outcome.explorerUrls?.[i] || undefined}
                    data-testid={`execution-audit-tx-${i}`}
                  />
                ))}
              </div>
            ) : null
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
