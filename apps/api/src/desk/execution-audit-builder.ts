/**
 * Mutable builder for DeskExecutionAuditV1 (Layer C spine).
 *
 * Strategy-runner owns the builder so policy preflight stays in one place;
 * the execution bridge returns submit/outcome fragments to merge.
 *
 */

import {
  buildExecutionAudit,
  buildGasNarrative,
  buildOutcomeStage,
  buildPreflightStage,
  buildSubmitStage,
  emptyAuditSkeleton,
  type BuildOutcomeStageInput,
  type BuildPreflightStageInput,
  type BuildSubmitStageInput,
  type DeskAuditGasNarrative,
  type DeskAuditKhSimulate,
  type DeskAuditOutcomeStage,
  type DeskAuditPolicySnapshot,
  type DeskAuditPreflightStage,
  type DeskAuditPreflightStatus,
  type DeskAuditRunNode,
  type DeskAuditSubmitStage,
  type DeskExecutionAuditV1,
} from "./execution-audit.ts";

export class ExecutionAuditBuilder {
  private preflight: DeskAuditPreflightStage | null = null;
  private submit: DeskAuditSubmitStage | null = null;
  private outcome: DeskAuditOutcomeStage | null = null;

  /** Snapshot policy decision into the preflight stage (Layer C). */
  recordPolicyPreflight(input: {
    at?: string;
    allow: boolean;
    reasonCodes?: string[];
    simulatedHfAfter?: number | null;
    gasRegime?: DeskAuditPolicySnapshot["gasRegime"];
    notionalUsdc?: number | null;
    strategy?: string | null;
    notes?: string | null;
    /** Override status; default derived from allow. */
    status?: DeskAuditPreflightStatus;
  }): this {
    const status: DeskAuditPreflightStatus =
      input.status ?? (input.allow ? "passed" : "failed");
    const policy: DeskAuditPolicySnapshot = {
      allow: input.allow,
      reasonCodes: input.reasonCodes ?? [],
    };
    if (input.simulatedHfAfter !== undefined) {
      policy.simulatedHfAfter = input.simulatedHfAfter;
    }
    if (input.gasRegime !== undefined) policy.gasRegime = input.gasRegime;
    if (input.notionalUsdc !== undefined) policy.notionalUsdc = input.notionalUsdc;
    if (input.strategy !== undefined) policy.strategy = input.strategy;

    this.preflight = buildPreflightStage({
      at: input.at,
      status,
      policy,
      notes: input.notes,
    });
    return this;
  }

  /** Replace or set preflight from a full stage (tests / advanced merge). */
  setPreflight(stage: DeskAuditPreflightStage | BuildPreflightStageInput): this {
    this.preflight =
      "id" in stage && stage.id === "preflight"
        ? stage
        : buildPreflightStage(stage as BuildPreflightStageInput);
    return this;
  }

  /**
   * Layer A — optional KH dry-run on preflight.
   * Soft: failed/error on a passed policy preflight → status `partial`.
   * Strict abort path should call `setPreflight` with status `failed` after this.
   */
  recordKhSimulate(khSimulate: DeskAuditKhSimulate, at?: string): this {
    if (!this.preflight) {
      this.preflight = buildPreflightStage({
        at,
        status: khSimulate.status === "passed" ? "passed" : "partial",
        khSimulate,
      });
      return this;
    }
    const softDegrade =
      this.preflight.status === "passed" &&
      (khSimulate.status === "failed" || khSimulate.status === "error");
    this.preflight = {
      ...this.preflight,
      khSimulate,
      status: softDegrade ? "partial" : this.preflight.status,
    };
    return this;
  }

  recordSubmit(input: BuildSubmitStageInput): this {
    this.submit = buildSubmitStage(input);
    return this;
  }

  /** Merge a submit fragment from the execution bridge (does not clear other stages). */
  mergeSubmit(stage: DeskAuditSubmitStage | BuildSubmitStageInput): this {
    const next =
      "id" in stage && stage.id === "submit"
        ? stage
        : buildSubmitStage(stage as BuildSubmitStageInput);
    this.submit = this.submit ? { ...this.submit, ...next, id: "submit" } : next;
    return this;
  }

  recordOutcome(input: BuildOutcomeStageInput): this {
    this.outcome = buildOutcomeStage(input);
    return this;
  }

  mergeOutcome(stage: DeskAuditOutcomeStage | BuildOutcomeStageInput): this {
    const next =
      "id" in stage && stage.id === "outcome"
        ? stage
        : buildOutcomeStage(stage as BuildOutcomeStageInput);
    if (!this.outcome) {
      this.outcome = next;
      return this;
    }
    this.outcome = {
      ...this.outcome,
      ...next,
      id: "outcome",
      txHashes:
        next.txHashes.length > 0 ? next.txHashes : this.outcome.txHashes,
    };
    return this;
  }

  /** Layer B — Phase 2 attaches per-node logs here. */
  recordRunNodes(
    nodes: DeskAuditRunNode[],
    meta?: { logsFetched?: boolean; logsFetchError?: string | null },
  ): this {
    if (!this.outcome) {
      this.outcome = buildOutcomeStage({
        status: "unknown",
        runNodes: nodes,
        logsFetched: meta?.logsFetched,
        logsFetchError: meta?.logsFetchError,
      });
      return this;
    }
    this.outcome = {
      ...this.outcome,
      runNodes: nodes,
      ...(meta?.logsFetched !== undefined ? { logsFetched: meta.logsFetched } : {}),
      ...(meta?.logsFetchError !== undefined
        ? { logsFetchError: meta.logsFetchError }
        : {}),
    };
    return this;
  }

  /** True when at least one stage has been recorded. */
  hasStages(): boolean {
    return this.preflight != null || this.submit != null || this.outcome != null;
  }

  /**
   * Assemble v1 audit. Missing stages default to skipped so the spine
   * always has preflight → submit → outcome.
   * Synthesizes smart gas narrative when estimate/used/regime are present.
   */
  build(at?: string): DeskExecutionAuditV1 {
    const ts = at ?? new Date().toISOString();
    const skeleton = emptyAuditSkeleton(ts);
    const preflight = this.preflight ?? skeleton.stages.preflight;
    let outcome = this.outcome ?? skeleton.stages.outcome;

    const narrative = buildGasNarrative(preflight, outcome);
    if (narrative && (!outcome.gasNarrative || !outcome.gasEstimateVsUsed)) {
      outcome = {
        ...outcome,
        gasNarrative: outcome.gasNarrative ?? narrative,
        gasEstimateVsUsed:
          outcome.gasEstimateVsUsed ??
          (narrative.estimate || narrative.used
            ? { estimate: narrative.estimate, used: narrative.used }
            : null),
      };
    }

    return buildExecutionAudit({
      preflight,
      submit: this.submit ?? skeleton.stages.submit,
      outcome,
    });
  }

  /** Snapshot without mutating — useful for mid-flight logging. */
  snapshot(at?: string): DeskExecutionAuditV1 {
    return this.build(at);
  }
}

export function createExecutionAuditBuilder(): ExecutionAuditBuilder {
  return new ExecutionAuditBuilder();
}
