/**
 * Desk execution audit narrative — Layer C spine types + pure helpers.
 *
 * Captures KeeperHub’s last-mile story as one continuous object:
 *   preflight (policy ± optional KH dry-run) → submit → outcome (± run nodes)
 *
 * Product copy glossary (prefer / avoid):
 *   Execution audit          / “MEV-proof log”
 *   Policy preflight         / “KeeperHub simulation” (for HF-only)
 *   KeeperHub dry-run        / bare “we simulated on DE” without context
 *   Workflow run / KH run    / “Job id” alone
 *   Private submission path  / “MEV-protected” as absolute claim
 *   Gas used                 / made-up estimates presented as fact
 *   Outcome filled / failed  / “Probably landed”
 *
 * Rules:
 * - Never invent txHash, gasUsed, or wouldRevert.
 * - Missing optional evidence → omit field or set skipped with notes.
 * - summaryLine is deterministic; LLM may paraphrase but must not add facts.
 * - Public redaction strips raw node inputs/outputs and secrets.
 *
 * @see docs/execution-audit-narrative-implementation-plan.md
 */

// ── Status unions ───────────────────────────────────────────────────────────

export type DeskAuditPreflightStatus = "passed" | "failed" | "skipped" | "partial";
export type DeskAuditKhSimulateStatus = "passed" | "failed" | "skipped" | "error";
export type DeskAuditSubmitStatus = "started" | "skipped" | "failed";
export type DeskAuditOutcomeStatus = "filled" | "failed" | "timeout" | "unknown" | "skipped";
export type DeskAuditGasRegime = "normal" | "elevated" | "critical";
export type DeskAuditRouting = "private_mempool" | "public";
export type DeskAuditKhSimulateEndpoint = "contract-call" | "transfer";

/** Additive smart gas narrative for execution audit reliability (Phase 3). */
export interface DeskAuditGasNarrative {
  estimate?: string | null;
  used?: string | null;
  usedWei?: string | null;
  regime?: DeskAuditGasRegime | null;
  attemptCount?: number | null;
  notes?: string | null;
}

// ── Stage shapes (DeskExecutionAuditV1) ─────────────────────────────────────

/** Policy preflight fields (Layer C) — never label HF-only as “KeeperHub simulation.” */
export interface DeskAuditPolicySnapshot {
  allow: boolean;
  reasonCodes: string[];
  simulatedHfAfter?: number | null;
  gasRegime?: DeskAuditGasRegime | null;
  notionalUsdc?: number | null;
  strategy?: string | null;
}

/**
 * Optional KeeperHub Direct Execution dry-run (Layer A).
 * Only present when a simulate:true call was attempted — never for production writes.
 */
export interface DeskAuditKhSimulate {
  attempted: boolean;
  status: DeskAuditKhSimulateStatus;
  wouldRevert?: boolean;
  gasEstimate?: string;
  revertReason?: string | null;
  from?: string;
  to?: string;
  endpoint?: DeskAuditKhSimulateEndpoint;
  errorMessage?: string | null;
}

export interface DeskAuditPreflightStage {
  id: "preflight";
  at: string;
  status: DeskAuditPreflightStatus;
  policy?: DeskAuditPolicySnapshot;
  /** Layer A — only when dry-run attempted. */
  khSimulate?: DeskAuditKhSimulate;
  notes?: string | null;
}

export interface DeskAuditSubmitStage {
  id: "submit";
  at: string;
  status: DeskAuditSubmitStatus;
  keeperHubRunId?: string | null;
  workflowId?: string | null;
  /** defend | rotate | oracle_arb | … */
  workflowAction?: string | null;
  idempotencyKey?: string | null;
  routing?: DeskAuditRouting | null;
  routingStrict?: boolean | null;
  routingProvider?: string | null;
  network?: string | null;
  chainId?: number | null;
  /**
   * How the workflow was triggered: KeeperHub MCP tools vs REST execute.
   * Set by execution-bridge when MCP preferred path is used.
   */
  executionPath?: "mcp" | "rest" | null;
  errorMessage?: string | null;
}

/** Per-node trace from KeeperHub GET …/logs (Layer B). Public-safe fields only. */
export interface DeskAuditRunNode {
  nodeId: string;
  nodeName?: string | null;
  nodeType?: string | null;
  status: string;
  durationMs?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  txHash?: string | null;
  explorerUrl?: string | null;
  gasUsed?: string | null;
  gasUsedUnits?: string | null;
  error?: string | null;
}

export interface DeskAuditOutcomeStage {
  id: "outcome";
  at: string;
  status: DeskAuditOutcomeStatus;
  terminalKhStatus?: string | null;
  txHashes: string[];
  explorerUrls?: string[];
  /** Gas units preferred when available from KH. */
  gasUsed?: string | null;
  gasUsedWei?: string | null;
  gasEstimateVsUsed?: {
    estimate?: string | null;
    used?: string | null;
  } | null;
  /** Additive smart gas narrative (Phase 3). */
  gasNarrative?: DeskAuditGasNarrative | null;
  errorMessage?: string | null;
  /** Layer B */
  runNodes?: DeskAuditRunNode[];
  logsFetched?: boolean;
  logsFetchError?: string | null;
}

/**
 * Versioned audit story attached to a desk ticket / intent.
 * Prefer storing on ticket payload as a sibling of the hashed canonical body
 * so on-chain ticketHash semantics stay stable (see plan §8.4).
 */
export interface DeskExecutionAuditV1 {
  version: 1;
  /** One-line editorial summary for cards and CIO fallback. */
  summaryLine: string;
  stages: {
    preflight: DeskAuditPreflightStage;
    submit: DeskAuditSubmitStage;
    outcome: DeskAuditOutcomeStage;
  };
}

/** Public ticket narrative convenience fields (API + web). */
export interface PublicExecutionAuditFields {
  executionAudit?: DeskExecutionAuditV1 | null;
  executionAuditSummary?: string | null;
  gasUsed?: string | null;
  gasUsedWei?: string | null;
}

/** Compact mirror fields for execution_logs.details (Activity). */
export interface ExecutionAuditLogDetails {
  execution_audit_version: 1;
  execution_audit_summary: string;
  keeper_hub_run_id?: string | null;
  preflight_status?: DeskAuditPreflightStatus | null;
  submit_at?: string | null;
  outcome_status?: DeskAuditOutcomeStatus | null;
  gas_used?: string | null;
  gas_used_wei?: string | null;
  tx_hashes?: string[];
  logs_node_count?: number | null;
  kh_simulate_status?: DeskAuditKhSimulateStatus | "skipped" | null;
}

export const DESK_EXECUTION_AUDIT_VERSION = 1 as const;

/** Cap for deterministic summaryLine (plan §9). */
export const EXECUTION_AUDIT_SUMMARY_MAX_LEN = 240 as const;

/** Cap for error fragment embedded in summaryLine. */
export const EXECUTION_AUDIT_ERROR_TRUNCATE = 60 as const;

// ── Stage builders (pure) ───────────────────────────────────────────────────

export interface BuildPreflightStageInput {
  at?: string;
  status: DeskAuditPreflightStatus;
  policy?: DeskAuditPolicySnapshot;
  khSimulate?: DeskAuditKhSimulate;
  notes?: string | null;
}

/** Build a preflight stage. Defaults `at` to now (ISO). */
export function buildPreflightStage(
  input: BuildPreflightStageInput,
): DeskAuditPreflightStage {
  const stage: DeskAuditPreflightStage = {
    id: "preflight",
    at: input.at ?? new Date().toISOString(),
    status: input.status,
  };
  if (input.policy !== undefined) stage.policy = input.policy;
  if (input.khSimulate !== undefined) stage.khSimulate = input.khSimulate;
  if (input.notes !== undefined) stage.notes = input.notes;
  return stage;
}

export interface BuildSubmitStageInput {
  at?: string;
  status: DeskAuditSubmitStatus;
  keeperHubRunId?: string | null;
  workflowId?: string | null;
  workflowAction?: string | null;
  idempotencyKey?: string | null;
  routing?: DeskAuditRouting | null;
  routingStrict?: boolean | null;
  routingProvider?: string | null;
  network?: string | null;
  chainId?: number | null;
  executionPath?: "mcp" | "rest" | null;
  errorMessage?: string | null;
}

/** Build a submit stage. Defaults `at` to now (ISO). */
export function buildSubmitStage(input: BuildSubmitStageInput): DeskAuditSubmitStage {
  const stage: DeskAuditSubmitStage = {
    id: "submit",
    at: input.at ?? new Date().toISOString(),
    status: input.status,
  };
  if (input.keeperHubRunId !== undefined) stage.keeperHubRunId = input.keeperHubRunId;
  if (input.workflowId !== undefined) stage.workflowId = input.workflowId;
  if (input.workflowAction !== undefined) stage.workflowAction = input.workflowAction;
  if (input.idempotencyKey !== undefined) stage.idempotencyKey = input.idempotencyKey;
  if (input.routing !== undefined) stage.routing = input.routing;
  if (input.routingStrict !== undefined) stage.routingStrict = input.routingStrict;
  if (input.routingProvider !== undefined) stage.routingProvider = input.routingProvider;
  if (input.network !== undefined) stage.network = input.network;
  if (input.chainId !== undefined) stage.chainId = input.chainId;
  if (input.executionPath !== undefined) stage.executionPath = input.executionPath;
  if (input.errorMessage !== undefined) stage.errorMessage = input.errorMessage;
  return stage;
}

export interface BuildOutcomeStageInput {
  at?: string;
  status: DeskAuditOutcomeStatus;
  terminalKhStatus?: string | null;
  txHashes?: string[];
  explorerUrls?: string[];
  gasUsed?: string | null;
  gasUsedWei?: string | null;
  gasEstimateVsUsed?: DeskAuditOutcomeStage["gasEstimateVsUsed"];
  gasNarrative?: DeskAuditGasNarrative | null;
  errorMessage?: string | null;
  runNodes?: DeskAuditRunNode[];
  logsFetched?: boolean;
  logsFetchError?: string | null;
}

/** Build an outcome stage. Defaults `at` to now; `txHashes` to []. */
export function buildOutcomeStage(input: BuildOutcomeStageInput): DeskAuditOutcomeStage {
  const stage: DeskAuditOutcomeStage = {
    id: "outcome",
    at: input.at ?? new Date().toISOString(),
    status: input.status,
    txHashes: input.txHashes ?? [],
  };
  if (input.terminalKhStatus !== undefined) stage.terminalKhStatus = input.terminalKhStatus;
  if (input.explorerUrls !== undefined) stage.explorerUrls = input.explorerUrls;
  if (input.gasUsed !== undefined) stage.gasUsed = input.gasUsed;
  if (input.gasUsedWei !== undefined) stage.gasUsedWei = input.gasUsedWei;
  if (input.gasEstimateVsUsed !== undefined) stage.gasEstimateVsUsed = input.gasEstimateVsUsed;
  if (input.gasNarrative !== undefined) stage.gasNarrative = input.gasNarrative;
  if (input.errorMessage !== undefined) stage.errorMessage = input.errorMessage;
  if (input.runNodes !== undefined) stage.runNodes = input.runNodes;
  if (input.logsFetched !== undefined) stage.logsFetched = input.logsFetched;
  if (input.logsFetchError !== undefined) stage.logsFetchError = input.logsFetchError;
  return stage;
}

/**
  * Synthesize gas narrative from preflight (Layer A dry-run + Layer C policy regime) and outcome (Layer B/C gas used).
  * Never invents numbers. Returns null if no gas or regime details exist.
  */
export function buildGasNarrative(
  preflight?: DeskAuditPreflightStage | null,
  outcome?: DeskAuditOutcomeStage | null,
): DeskAuditGasNarrative | null {
  const estimate = preflight?.khSimulate?.gasEstimate ?? outcome?.gasEstimateVsUsed?.estimate ?? null;
  const used = outcome?.gasUsed ?? outcome?.gasEstimateVsUsed?.used ?? null;
  const usedWei = outcome?.gasUsedWei ?? null;
  const regime = preflight?.policy?.gasRegime ?? null;

  if (!estimate && !used && !usedWei && !regime) return null;

  const notesParts: string[] = [];
  if (estimate) notesParts.push("estimate from Layer A dry-run");
  if (used) notesParts.push("used from workflow execution logs");

  return {
    estimate: estimate || null,
    used: used || null,
    usedWei: usedWei || null,
    regime: regime || null,
    notes: notesParts.length > 0 ? notesParts.join("; ") : null,
  };
}

export interface BuildRunNodeInput {
  nodeId: string;
  nodeName?: string | null;
  nodeType?: string | null;
  status: string;
  durationMs?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  txHash?: string | null;
  explorerUrl?: string | null;
  gasUsed?: string | null;
  gasUsedUnits?: string | null;
  error?: string | null;
}

/**
 * Build a public-safe run node. Never accepts raw `input` / `output` payloads —
 * those must stay off the public ticket surface.
 */
export function buildRunNode(input: BuildRunNodeInput): DeskAuditRunNode {
  const node: DeskAuditRunNode = {
    nodeId: input.nodeId,
    status: input.status,
  };
  if (input.nodeName !== undefined) node.nodeName = input.nodeName;
  if (input.nodeType !== undefined) node.nodeType = input.nodeType;
  if (input.durationMs !== undefined) node.durationMs = input.durationMs;
  if (input.startedAt !== undefined) node.startedAt = input.startedAt;
  if (input.completedAt !== undefined) node.completedAt = input.completedAt;
  if (input.txHash !== undefined) node.txHash = input.txHash;
  if (input.explorerUrl !== undefined) node.explorerUrl = input.explorerUrl;
  if (input.gasUsed !== undefined) node.gasUsed = input.gasUsed;
  if (input.gasUsedUnits !== undefined) node.gasUsedUnits = input.gasUsedUnits;
  if (input.error !== undefined) node.error = input.error;
  return node;
}

/**
 * Empty audit skeleton with skipped stages.
 * Useful before capture points fill real data; summaryLine is recomputed on build.
 */
export function emptyAuditSkeleton(at?: string): DeskExecutionAuditV1 {
  const ts = at ?? new Date().toISOString();
  const audit: DeskExecutionAuditV1 = {
    version: DESK_EXECUTION_AUDIT_VERSION,
    summaryLine: "",
    stages: {
      preflight: buildPreflightStage({ at: ts, status: "skipped" }),
      submit: buildSubmitStage({ at: ts, status: "skipped" }),
      outcome: buildOutcomeStage({ at: ts, status: "skipped" }),
    },
  };
  audit.summaryLine = buildSummaryLine(audit);
  return audit;
}

/**
 * Assemble a complete v1 audit from stages and compute summaryLine.
 * Prefer this over hand-writing summaryLine.
 */
export function buildExecutionAudit(stages: {
  preflight: DeskAuditPreflightStage;
  submit: DeskAuditSubmitStage;
  outcome: DeskAuditOutcomeStage;
}): DeskExecutionAuditV1 {
  const audit: DeskExecutionAuditV1 = {
    version: DESK_EXECUTION_AUDIT_VERSION,
    summaryLine: "",
    stages,
  };
  audit.summaryLine = buildSummaryLine(audit);
  return audit;
}

// ── Summary line (deterministic, plan §9) ───────────────────────────────────

/** Format gas units for summary — plain decimal string, no invented precision. */
export function formatAuditGas(gasUsed: string): string {
  const trimmed = gasUsed.trim();
  if (!trimmed) return trimmed;
  // Strip leading zeros but keep "0"
  if (/^\d+$/.test(trimmed)) {
    return BigInt(trimmed).toString();
  }
  return trimmed;
}

function capitalizeStatus(status: string): string {
  if (!status) return status;
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function truncateError(message: string, max = EXECUTION_AUDIT_ERROR_TRUNCATE): string {
  const oneLine = message.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

/**
 * Deterministic one-line editorial summary from stages.
 *
 * Examples:
 * - `Preflight passed → Submit run · private → filled · 61234 gas`
 * - `Preflight passed · KH sim passed → Submit run → failed · insufficient allowance`
 * - `Preflight failed → Submit skipped → unknown · simulated_hf_below_warn`
 */
export function buildSummaryLine(audit: DeskExecutionAuditV1): string {
  const { preflight, submit, outcome } = audit.stages;
  const parts: string[] = [];

  parts.push(`Preflight ${preflight.status}`);

  const khStatus = preflight.khSimulate?.status;
  if (khStatus) {
    parts.push(`· KH sim ${khStatus}`);
  }

  const submitLabel = submit.keeperHubRunId ? "run" : submit.status;
  parts.push(`→ Submit ${submitLabel}`);

  if (submit.routing === "private_mempool") {
    parts.push("· private");
  }

  parts.push(`→ ${capitalizeStatus(outcome.status)}`);

  if (outcome.gasUsed) {
    parts.push(`· ${formatAuditGas(outcome.gasUsed)} gas`);
  }

  const failedLike =
    outcome.status === "failed" ||
    outcome.status === "timeout" ||
    preflight.status === "failed";
  if (failedLike) {
    const err =
      outcome.errorMessage?.trim() ||
      (preflight.status === "failed"
        ? preflight.policy?.reasonCodes?.[0] ?? preflight.notes?.trim() ?? null
        : null);
    if (err) {
      parts.push(`· ${truncateError(err)}`);
    }
  }

  const joined = parts.join(" ");
  if (joined.length <= EXECUTION_AUDIT_SUMMARY_MAX_LEN) return joined;
  return `${joined.slice(0, EXECUTION_AUDIT_SUMMARY_MAX_LEN - 1)}…`;
}

// ── Public redaction ────────────────────────────────────────────────────────

/** Keys that must never appear on public run-node / audit surfaces. */
const FORBIDDEN_PUBLIC_NODE_KEYS = new Set([
  "input",
  "output",
  "inputs",
  "outputs",
  "rawInput",
  "rawOutput",
  "nodeInput",
  "nodeOutput",
  "privateKey",
  "secret",
  "apiKey",
  "authorization",
  "auth",
  "password",
  "mnemonic",
  "seed",
]);

const PUBLIC_RUN_NODE_KEYS = [
  "nodeId",
  "nodeName",
  "nodeType",
  "status",
  "durationMs",
  "startedAt",
  "completedAt",
  "txHash",
  "explorerUrl",
  "gasUsed",
  "gasUsedUnits",
  "error",
] as const satisfies readonly (keyof DeskAuditRunNode)[];

/**
 * Strip a raw KeeperHub log node (or any loose object) down to public-safe fields.
 * Drops input/output payloads and any forbidden secret-like keys.
 */
export function redactRunNodeForPublic(raw: unknown): DeskAuditRunNode | null {
  if (raw === null || raw === undefined || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;

  const nodeId =
    (typeof src.nodeId === "string" && src.nodeId) ||
    (typeof src.id === "string" && src.id) ||
    null;
  if (!nodeId) return null;

  const status =
    (typeof src.status === "string" && src.status) ||
    (typeof src.state === "string" && src.state) ||
    "unknown";

  const node = buildRunNode({
    nodeId,
    status,
    nodeName: optionalString(src.nodeName ?? src.name),
    nodeType: optionalString(src.nodeType ?? src.type),
    durationMs: optionalNumber(src.durationMs ?? src.duration),
    startedAt: optionalString(src.startedAt),
    completedAt: optionalString(src.completedAt),
    txHash: optionalString(src.txHash ?? src.transactionHash),
    explorerUrl: optionalString(src.explorerUrl),
    gasUsed: optionalStringOrNumber(src.gasUsed),
    gasUsedUnits: optionalStringOrNumber(src.gasUsedUnits),
    error: optionalString(src.error ?? src.errorMessage),
  });

  // Defense in depth: ensure no forbidden keys leaked via accidental spread.
  const nodeRecord = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(nodeRecord)) {
    if (FORBIDDEN_PUBLIC_NODE_KEYS.has(key)) {
      delete nodeRecord[key];
    }
  }

  return node;
}

function optionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") return value;
  return undefined;
}

function optionalNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function optionalStringOrNumber(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return undefined;
}

/**
 * Deep-clone an audit for the public ticket API.
 * - Recomputes summaryLine from stages (source of truth).
 * - Redacts run nodes to the public allow-list (no raw inputs/outputs).
 * - Never fabricates hashes, gas, or wouldRevert.
 */
export function toPublicExecutionAudit(
  audit: DeskExecutionAuditV1 | null | undefined,
): DeskExecutionAuditV1 | null {
  if (!audit || audit.version !== 1) return null;

  const runNodes = audit.stages.outcome.runNodes
    ?.map((n) => redactRunNodeForPublic(n))
    .filter((n): n is DeskAuditRunNode => n !== null);

  const outcome: DeskAuditOutcomeStage = {
    ...audit.stages.outcome,
    id: "outcome",
    txHashes: [...(audit.stages.outcome.txHashes ?? [])],
    explorerUrls: audit.stages.outcome.explorerUrls
      ? [...audit.stages.outcome.explorerUrls]
      : undefined,
  };
  if (runNodes !== undefined) {
    outcome.runNodes = runNodes;
  } else {
    delete outcome.runNodes;
  }

  // Strip any accidental non-public keys that may have been merged onto nodes.
  if (outcome.runNodes) {
    outcome.runNodes = outcome.runNodes.map((n) => pickPublicRunNode(n));
  }

  const publicAudit: DeskExecutionAuditV1 = {
    version: 1,
    summaryLine: "",
    stages: {
      preflight: { ...audit.stages.preflight, id: "preflight" },
      submit: { ...audit.stages.submit, id: "submit" },
      outcome,
    },
  };
  publicAudit.summaryLine = buildSummaryLine(publicAudit);
  return publicAudit;
}

function pickPublicRunNode(node: DeskAuditRunNode): DeskAuditRunNode {
  const out: DeskAuditRunNode = {
    nodeId: node.nodeId,
    status: node.status,
  };
  const outRecord = out as unknown as Record<string, unknown>;
  for (const key of PUBLIC_RUN_NODE_KEYS) {
    if (key === "nodeId" || key === "status") continue;
    const value = node[key];
    if (value !== undefined) {
      outRecord[key] = value;
    }
  }
  return out;
}

/**
 * Convenience fields for PublicDeskTicketNarrative / list cards.
 * Returns nulls when audit is absent (legacy tickets).
 */
export function publicExecutionAuditFields(
  audit: DeskExecutionAuditV1 | null | undefined,
): PublicExecutionAuditFields {
  const publicAudit = toPublicExecutionAudit(audit);
  if (!publicAudit) {
    return {
      executionAudit: null,
      executionAuditSummary: null,
      gasUsed: null,
      gasUsedWei: null,
    };
  }
  return {
    executionAudit: publicAudit,
    executionAuditSummary: publicAudit.summaryLine,
    gasUsed: publicAudit.stages.outcome.gasUsed ?? null,
    gasUsedWei: publicAudit.stages.outcome.gasUsedWei ?? null,
  };
}

/**
 * Compact mirror for execution_logs.details — Activity can show summary later
 * without a full redesign (plan §6.3).
 */
export function toExecutionAuditLogDetails(
  audit: DeskExecutionAuditV1,
): ExecutionAuditLogDetails {
  const { preflight, submit, outcome } = audit.stages;
  const details: ExecutionAuditLogDetails = {
    execution_audit_version: 1,
    execution_audit_summary: audit.summaryLine || buildSummaryLine(audit),
    keeper_hub_run_id: submit.keeperHubRunId ?? null,
    preflight_status: preflight.status,
    submit_at: submit.at,
    outcome_status: outcome.status,
    gas_used: outcome.gasUsed ?? null,
    gas_used_wei: outcome.gasUsedWei ?? null,
    tx_hashes: [...outcome.txHashes],
    logs_node_count: outcome.runNodes?.length ?? null,
    kh_simulate_status: preflight.khSimulate?.status ?? "skipped",
  };
  return details;
}

/**
 * Type guard for persisted payload JSON.
 * Accepts only version 1 with the three required stages.
 */
export function isDeskExecutionAuditV1(value: unknown): value is DeskExecutionAuditV1 {
  if (value === null || value === undefined || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return false;
  if (typeof v.summaryLine !== "string") return false;
  if (v.stages === null || typeof v.stages !== "object") return false;
  const stages = v.stages as Record<string, unknown>;
  for (const id of ["preflight", "submit", "outcome"] as const) {
    const stage = stages[id];
    if (stage === null || typeof stage !== "object") return false;
    const s = stage as Record<string, unknown>;
    if (s.id !== id || typeof s.at !== "string" || typeof s.status !== "string") {
      return false;
    }
  }
  return true;
}

/**
 * Parse audit from ticket payload (or null for legacy tickets).
 * Does not invent missing data — returns null if shape is wrong.
 */
export function parseExecutionAuditFromPayload(
  payload: unknown,
): DeskExecutionAuditV1 | null {
  if (payload === null || payload === undefined || typeof payload !== "object") {
    return null;
  }
  const raw = (payload as Record<string, unknown>).executionAudit;
  if (!isDeskExecutionAuditV1(raw)) return null;
  return raw;
}
