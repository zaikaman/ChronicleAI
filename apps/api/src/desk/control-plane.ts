/**
 * Desk control plane: orchestrates capital ticks, strategy ticks, execution
 * callbacks, kill-switch arming, and public status snapshots for HTTP routes.
 */

import type {
  DeskAgentRunRepository,
  DeskAgentRunRow,
  DeskCapitalMoveRepository,
  DeskCapitalMoveRow,
  DeskHeartbeatRow,
  DeskIntentRow,
  DeskPositionRow,
  DeskSignalRepository,
  DeskSignalRow,
  DeskTicketRow,
  ExecutionLogRepository,
  MonitoredEventRepository,
  MonitoredEventRow,
  PublicAlertRepository,
} from "@chronicleai/db";
import type {
  AlertActionStatus,
  DeskAgentProposal,
  DeskHeartbeatSource,
  DeskPolicyVerdict,
  DeskSignalType,
  DeskStrategy,
  ExecutionLogStatus,
} from "@chronicleai/schemas";
import { DESK_STRATEGIES } from "@chronicleai/schemas";
import { ACTIVE_INTELLIGENCE_CHAIN_ID, PRIMARY_SIGNAL_CHAIN_ID } from "@chronicleai/config";
import { capitalLog, deskLog } from "../lib/logger.ts";
import { softAppendExecutionLog } from "../services/keeperhub-execution-log.ts";
import {
  type RoutingPolicyEnv,
  extractRoutingFromDetails,
  flashbotsProtectStatusUrl,
  publicPrivateRoutingStatus,
  routingExecutionPathCopy,
  shouldLinkProtectStatus,
} from "../services/routing-metadata.ts";
import type { DeskTradingAgent } from "./agent/desk-trading-agent.ts";
import type { FailureClassifier } from "./agent/failure-classifier.ts";
import {
  applyForceDefendOverride,
  applyForceMaintenanceOverride,
  applyMinConfidence,
  mapProposalToDecision,
} from "./agent/map-proposal.ts";
import type { NarrativeService } from "./agent/narrative.ts";
import { isDeskAgentProposal } from "./agent/proposal-schema.ts";
import { contextDigest } from "./agent/tools.ts";
import type { DeskAgentContext, PublicDeskAgentSummary } from "./agent/types.ts";
import type { CapitalManager, CapitalManagerTickResult } from "./capital-manager.ts";
import {
  type EventMicrotradeTrigger,
  evaluateAndPlanEventMicrotrade,
  isEventMicrotradeTriggerType,
} from "./event-microtrade-hook.ts";
import { parseExecutionAuditFromPayload, publicExecutionAuditFields } from "./execution-audit.ts";
import type { ExecutionBridge } from "./execution-bridge.ts";
import type { HeartbeatService } from "./heartbeat-service.ts";
import type { IntentService } from "./intent-service.ts";
import type {
  KillSwitchService,
  KillSwitchState,
  KillSwitchTripResult,
} from "./kill-switch-service.ts";
import { detectPowderThrash } from "./policy-engine.ts";
import type { PositionService } from "./position-service.ts";
import type {
  StrategyEvaluateResult,
  StrategyExecuteResult,
  StrategyInventory,
  StrategyRunner,
} from "./strategy-runner.ts";
import type { TicketPublishResult, TicketService } from "./ticket-service.ts";
import type {
  DeskExecutionResultInput,
  DeskIntentFill,
  DeskLeg,
  DeskPolicyConfig,
  DeskPositionMark,
  GasRegime,
  HeartbeatStatus,
} from "./types.ts";

// ── Signal → strategy mapping ───────────────────────────

export function strategyForSignalType(signalType: DeskSignalType | string): DeskStrategy | null {
  switch (signalType) {
    case "health_factor":
    case "liquidation_cluster":
      return "risk_defend";
    case "apy_delta":
      return "yield_rotation";
    case "oracle_basis":
      return "oracle_amm";
    default:
      return null;
  }
}

// ── Public response shapes ──────────────────────────────

export interface PublicPrivateRoutingStatus {
  /** Whether desk prefers private mempool submission (Flashbots Protect · Sepolia). */
  enabled: boolean;
  /** Workflow strict mode expectation. */
  strict: boolean;
  /** Provider label for UI (e.g. flashbots_protect). */
  provider: string;
  chainId: number;
  /** Calm product label, e.g. "Private routing: ON". */
  label: string;
}

export interface PublicDeskStatus {
  chainId: number;
  deskWalletAddress: string | null;
  treasuryWalletAddress: string | null;
  equityUsdc: number | null;
  freeUsdc: number | null;
  targetAumUsdc: number;
  maxAumUsdc: number;
  minAumUsdc: number;
  healthFactor: number | null;
  paused: boolean;
  killSwitch: KillSwitchState;
  heartbeat: HeartbeatStatus;
  lastPositionAsOf: string | null;
  lastTopupAt: string | null;
  lastSweepAt: string | null;
  policy: {
    maxTradeUsdc: number;
    hfWarn: number;
    hfCritical: number;
    basisBps: number;
    apyDeltaBps: number;
  };
  /**
   * Private routing policy surface (Phase 2). When present, desk status panel
   * shows "Private routing: ON/OFF" for Sepolia KH submissions.
   */
  privateRouting?: PublicPrivateRoutingStatus | null;
  /** Last LLM agent action (hold/propose/defend/defer) + age. */
  lastAgent: PublicDeskAgentSummary | null;
  /**
   * True when the mandatory LLM path is live (agent wired + ≥1 LLM key).
   * False = fail-closed: no risk-increasing intents (force-defend may still apply).
   * There is no env switch to disable the LLM path.
   */
  agentEnabled: boolean;
  /** Why the agent path is not ready when agentEnabled is false. */
  agentBlockedReason: string | null;
}

export interface PublicDeskIntentSummary {
  id: string;
  strategy: string;
  status: string;
  notionalUsdc: number;
  reasonCodes: string[];
  legCount: number;
  keeperHubRunId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  /** Agent thesis snippet when stored on policy_snapshot.agent */
  agentThesis: string | null;
  agentConfidence: number | null;
  agentAction: string | null;
  /** Routing mode when stored on policy_snapshot (Phase 2). */
  routing?: string | null;
}

export interface PremiumDeskIntentDetail extends PublicDeskIntentSummary {
  signalId: string | null;
  legs: DeskLeg[];
  policySnapshot: Record<string, unknown>;
}

export interface PublicDeskTicketSummary {
  id: string;
  intentId: string;
  ticketHash: string;
  signalHash: string | null;
  intentHash: string | null;
  contentUri: string | null;
  txHash: string | null;
  explorerUrl: string | null;
  keeperHubRunId: string | null;
  summary: string | null;
  createdAt: string;
}

/** Public narrative fields for editorial ticket pages (not full payload). */
export interface PublicDeskTicketNarrative extends PublicDeskTicketSummary {
  strategy: string | null;
  notionalUsdc: number | null;
  signalType: string | null;
  /** Safe leg summary: protocol + action (+ optional asset labels). */
  legs: Array<{
    protocol: string;
    action: string;
    asset?: string | null;
    tokenIn?: string | null;
    tokenOut?: string | null;
  }>;
  reasonCodes: string[];
  fillsCount: number;
  fillTxHashes: string[];
  /** Agent thesis from policy.agent when present. */
  agentThesis: string | null;
  agentConfidence: number | null;
  agentAction: string | null;
  /**
   * Execution routing for this ticket (private_mempool | public) when stored
   * on ticket policy at fill time (Phase 2).
   */
  routing?: string | null;
  routingStrict?: boolean | null;
  routingProvider?: string | null;
  /** Calm product copy for ticket detail page. */
  executionPath?: string | null;
  /**
   * Flashbots Protect status URL for fill/registry txs when private routing
   * was requested (Sepolia). Optional Phase 4 UX.
   */
  protectStatusUrl?: string | null;
  /** Protect status links for each fill tx hash (when private route). */
  protectStatusUrls?: Array<{ txHash: string; url: string }> | null;
  /**
   * Continuous KeeperHub audit story (preflight → submit → outcome).
   * Public-safe; null/omitted on legacy tickets.
   */
  executionAudit?: import("./execution-audit.ts").DeskExecutionAuditV1 | null;
  /** Convenience one-liner (same as executionAudit.summaryLine). */
  executionAuditSummary?: string | null;
  /** Outcome gas units when known — never invented. */
  gasUsed?: string | null;
  gasUsedWei?: string | null;
}

export interface PremiumDeskTicketDetail extends PublicDeskTicketSummary {
  payload: Record<string, unknown>;
}

export interface PublicCapitalMove {
  id: string;
  direction: string;
  amountUsdc: number;
  fromAddress: string;
  toAddress: string;
  /** Transfer / workflow tx (funding path). */
  txHash: string | null;
  explorerUrl: string | null;
  /** On-chain recordCapitalMove audit (distinct from transfer). */
  registryTxHash: string | null;
  registryExplorerUrl: string | null;
  keeperHubRunId: string | null;
  reason: string | null;
  treasuryUsdcAfter: number | null;
  deskEquityAfter: number | null;
  createdAt: string;
}

export interface DeskTickResult {
  heartbeat: DeskHeartbeatRow;
  mark: DeskPositionMark | null;
  markError?: string | undefined;
  evaluations: Array<{
    signalId: string | null;
    signalType: string;
    strategy: DeskStrategy;
    planAction: string;
    policyAllow?: boolean | undefined;
    intentId?: string | undefined;
    reasonCodes: string[];
  }>;
  executions: StrategyExecuteResult[];
  kill?: KillSwitchTripResult | undefined;
  agentProposal?: DeskAgentProposal | undefined;
  agentRunId?: string | undefined;
  agentSkippedRisk?: boolean | undefined;
  /** Phase 5: event-linked microtrade outcome when the feature is enabled. */
  eventMicrotrade?: {
    attempted: boolean;
    allowed: boolean;
    skipReason?: string | undefined;
    mode?: string | undefined;
    monitoredEventId?: string | null | undefined;
    intentId?: string | undefined;
    reasonCodes: string[];
  };
}

export interface CapitalTickHttpResult {
  mark: DeskPositionMark | null;
  markError?: string | undefined;
  capital: CapitalManagerTickResult;
  /** Sepolia treasury USDC (ops rail). */
  treasuryUsdc: number | null;
  treasuryEth: number | null;
  /** Base treasury USDC when dual-rail is available (payment rail). */
  treasuryBaseUsdc?: number | null;
}

export interface ExecutionResultHttpResult {
  intent: DeskIntentRow;
  ticket?: TicketPublishResult | undefined;
}

export interface DeskControlPlane {
  /** POST /keeperhub/desk/capital */
  runCapitalTick(body?: Record<string, unknown>): Promise<CapitalTickHttpResult>;
  /** POST /keeperhub/desk/tick */
  runDeskTick(body?: Record<string, unknown>): Promise<DeskTickResult>;
  /**
   * Build context → run LLM agent → return proposal (persists agent run).
   * Safe hold when agent disabled, no LLM key, or LLM fails.
   * Strategy intents require this path — there is no legacy signal-only bypass.
   */
  runAgentOnly(body?: Record<string, unknown>): Promise<{
    proposal: DeskAgentProposal;
    agentRunId: string | null;
    context: DeskAgentContext;
    safeDefault: boolean;
    errorMessage?: string | undefined;
  }>;
  /** POST /keeperhub/desk/execution-result */
  applyExecutionResult(body: Record<string, unknown>): Promise<ExecutionResultHttpResult>;
  /** POST /keeperhub/desk/kill */
  armKill(body?: Record<string, unknown>): Promise<{
    state: KillSwitchState;
    trip?: KillSwitchTripResult | undefined;
  }>;

  getStatus(): Promise<PublicDeskStatus>;
  getLatestAgent(): Promise<PublicDeskAgentSummary | null>;
  getLatestPosition(): Promise<DeskPositionRow | null>;
  markLive(persist?: boolean): Promise<DeskPositionMark>;
  listIntents(limit?: number): Promise<DeskIntentRow[]>;
  listIntentsPage(params?: {
    page?: number;
    limit?: number;
  }): Promise<import("@chronicleai/db").PaginatedResult<DeskIntentRow>>;
  listTickets(limit?: number): Promise<DeskTicketRow[]>;
  listTicketsPage(params?: {
    page?: number;
    limit?: number;
  }): Promise<import("@chronicleai/db").PaginatedResult<DeskTicketRow>>;
  getTicket(id: string): Promise<DeskTicketRow | null>;
  findTicketBySignalHash(signalHash: string): Promise<DeskTicketRow | null>;
  findTicketByIntentId(intentId: string): Promise<DeskTicketRow | null>;
  listCapitalMoves(limit?: number): Promise<DeskCapitalMoveRow[]>;
  listCapitalMovesPage(params?: {
    page?: number;
    limit?: number;
  }): Promise<import("@chronicleai/db").PaginatedResult<DeskCapitalMoveRow>>;
  getKillState(): KillSwitchState;
  getConfig(): DeskPolicyConfig;
  getDeskWalletAddress(): string | null;
  getTreasuryWalletAddress(): string | null;
  /** True when mandatory LLM path is live (wired + LLM configured). */
  isAgentEnabled(): boolean;
  /** Null when ready; otherwise fail-closed reason code. */
  getAgentBlockedReason(): string | null;
}

export interface DeskAgentControlConfig {
  /** At least one LLM provider API key is configured. */
  llmConfigured: boolean;
  maxSignals: number;
  minConfidence: number;
  forceDefendOnCriticalHf: boolean;
}

export interface DeskControlPlaneDeps {
  config: DeskPolicyConfig;
  chainId: number;
  deskWalletAddress: string | null;
  treasuryWalletAddress: string | null;
  usdcOperatingReserve: number;
  treasurySafetyBufferEth: number;

  heartbeats: HeartbeatService;
  positions: PositionService | null;
  intents: IntentService;
  tickets: TicketService;
  capitalManager: CapitalManager | null;
  capitalMoves: DeskCapitalMoveRepository;
  killSwitch: KillSwitchService;
  strategyRunner: StrategyRunner;
  signals: DeskSignalRepository;
  /** Optional public Alert repository for live causal-chain updates. */
  alertRepo?: PublicAlertRepository | null | undefined;
  /**
   * Optional Desk-trigger Alert service for capital / microtrade / signal Alerts.
   * Failures are best-effort and must never block safe Desk execution.
   */
  deskTriggerAlerts?: import("../services/desk-trigger-alert-service.ts").DeskTriggerAlertService | null;
  executionBridge?: ExecutionBridge | null;

  /**
   * Mandatory LLM trading agent. When missing or not ready, strategy ticks
   * fail closed to hold (plus code force-defend on critical HF).
   */
  agent?: DeskTradingAgent | null | undefined;
  agentRuns?: DeskAgentRunRepository | null | undefined;
  agentConfig?: DeskAgentControlConfig | undefined;
  failureClassifier?: FailureClassifier | null | undefined;
  narrative?: NarrativeService | null | undefined;
  /**
   * Optional Activity / execution_logs writer (Phase 0 instrumentation).
   * Soft-fails: never throws out of desk ticks when logging fails.
   */
  execLogRepo?: ExecutionLogRepository | null | undefined;

  /**
   * Private routing policy env for desk status panel (Phase 2).
   * When set, GET /desk/status includes privateRouting: { enabled, label, … }.
   */
  routingPolicyEnv?: RoutingPolicyEnv | null | undefined;

  /** Live treasury USDC + ETH (null when unreadable). Sepolia ops pocket. */
  loadTreasuryBalances: () => Promise<{
    usdcBalance: number;
    ethBalance: number;
  } | null>;

  /**
   * Optional dual-rail balances for capital starvation messaging.
   * Base USDC is never spent by capital manager — only used to detect
   * "Sepolia low / Base flush → awaiting CCTP".
   */
  loadDualRailTreasuryBalances?: () => Promise<{
    treasuryBaseUsdc: number;
    treasurySepoliaUsdc: number;
    treasuryBaseEth?: number;
    treasurySepoliaEth?: number;
    inFlightUsdc?: number;
  } | null>;

  /** CCTP policy knobs for starvation messaging (optional). */
  cctpBaseSafetyBufferUsdc?: number;
  cctpRebalanceThresholdUsdc?: number;

  /** Mutable pause mirror for env DESK_PAUSED + kill arm. */
  getDeskPaused: () => boolean;
  setDeskPaused: (paused: boolean) => void;

  /**
   * Optional control-state repo for last_maintenance_at (A2 cadence)
   * and last_event_microtrade_at (Phase 5 cooldown).
   * When omitted, cadence maintenance is always interval-due.
   */
  controlState?: import("@chronicleai/db").DeskControlStateRepository | null;

  /**
   * Optional monitored-events repo for Phase 5 newspaper → desk microtrade.
   * When omitted or feature disabled, event microtrade is a no-op.
   */
  monitoredEvents?: MonitoredEventRepository | null | undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Normalize persisted Aave snapshots for the public desk status response.
 *
 * Older rows may use snake_case, and rows written before the no-debt sentinel
 * was introduced contain `healthFactor: null` even though Aave reported the
 * valid max/infinite health factor. Keep the distinction between no debt and
 * unavailable data instead of exposing both as `n/a`.
 */
export function normalizePublicHealthFactor(
  aave: Record<string, unknown> | null | undefined,
): number | null {
  if (!aave || typeof aave !== "object") return null;

  const direct = asNumber(aave.healthFactor ?? aave.health_factor);
  if (direct !== undefined) return direct;

  const totalDebtUsd = asNumber(aave.totalDebtUsd ?? aave.total_debt_usd);
  if (totalDebtUsd !== undefined && totalDebtUsd <= 0) return 999;

  const raw =
    aave.raw && typeof aave.raw === "object"
      ? (aave.raw as Record<string, unknown>)
      : null;
  const totalDebtBase = asNumber(raw?.totalDebtBase ?? raw?.total_debt_base);
  if (totalDebtBase !== undefined && totalDebtBase <= 0) return 999;

  return null;
}

function asBoolean(value: unknown, defaultValue = false): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return defaultValue;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return undefined;
}

function agentFieldsFromSnapshot(snapshot: unknown): {
  thesis: string | null;
  confidence: number | null;
  action: string | null;
} {
  const rec =
    snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
      ? (snapshot as Record<string, unknown>)
      : null;
  const agent = rec?.agent;
  if (!isDeskAgentProposal(agent)) {
    return { thesis: null, confidence: null, action: null };
  }
  return {
    thesis: agent.thesis?.slice(0, 400) ?? null,
    confidence: typeof agent.confidence === "number" ? agent.confidence : null,
    action: agent.action,
  };
}

export function toPublicIntent(row: DeskIntentRow): PublicDeskIntentSummary {
  const legs = Array.isArray(row.legs) ? row.legs : [];
  const agent = agentFieldsFromSnapshot(row.policy_snapshot);
  const snapshot =
    row.policy_snapshot && typeof row.policy_snapshot === "object"
      ? (row.policy_snapshot as Record<string, unknown>)
      : null;
  const routingMeta = extractRoutingFromDetails(snapshot);
  return {
    id: row.id,
    strategy: row.strategy,
    status: row.status,
    notionalUsdc: row.notional_usdc,
    reasonCodes: row.reason_codes ?? [],
    legCount: legs.length,
    keeperHubRunId: row.keeper_hub_run_id,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    agentThesis: agent.thesis,
    agentConfidence: agent.confidence,
    agentAction: agent.action,
    routing: routingMeta?.routing ?? null,
  };
}

export function toPremiumIntent(row: DeskIntentRow): PremiumDeskIntentDetail {
  const legs = (Array.isArray(row.legs) ? row.legs : []) as DeskLeg[];
  return {
    ...toPublicIntent(row),
    signalId: row.signal_id,
    legs,
    policySnapshot:
      row.policy_snapshot && typeof row.policy_snapshot === "object"
        ? (row.policy_snapshot as Record<string, unknown>)
        : {},
  };
}

export function toPublicTicket(row: DeskTicketRow): PublicDeskTicketSummary {
  return {
    id: row.id,
    intentId: row.intent_id,
    ticketHash: row.ticket_hash,
    signalHash: row.signal_hash,
    intentHash: row.intent_hash,
    contentUri: row.content_uri,
    txHash: row.tx_hash,
    explorerUrl: row.explorer_url,
    keeperHubRunId: row.keeper_hub_run_id,
    summary: row.summary,
    createdAt: row.created_at,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asOptionalString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return null;
}

/**
 * Public editorial ticket: signal → decision → legs → proofs.
 * Strips raw policy/features detail; full payload remains premium-only.
 */
export function toPublicTicketNarrative(row: DeskTicketRow): PublicDeskTicketNarrative {
  const base = toPublicTicket(row);
  const payload = asRecord(row.payload) ?? {};
  const signal = asRecord(payload.signal);
  const policy = asRecord(payload.policy) ?? {};
  const rawLegs = Array.isArray(payload.legs) ? payload.legs : [];
  const rawFills = Array.isArray(payload.fills) ? payload.fills : [];

  const legs = rawLegs.map((leg) => {
    const l = asRecord(leg) ?? {};
    const entry: PublicDeskTicketNarrative["legs"][number] = {
      protocol: asOptionalString(l.protocol) ?? "unknown",
      action: asOptionalString(l.action) ?? "unknown",
    };
    const asset = asOptionalString(l.asset);
    const tokenIn = asOptionalString(l.tokenIn);
    const tokenOut = asOptionalString(l.tokenOut);
    if (asset) entry.asset = asset;
    if (tokenIn) entry.tokenIn = tokenIn;
    if (tokenOut) entry.tokenOut = tokenOut;
    return entry;
  });

  const fillTxHashes = rawFills
    .map((f) => asOptionalString(asRecord(f)?.txHash))
    .filter((h): h is string => Boolean(h));

  const reasonFromPolicy = Array.isArray(policy.reasonCodes)
    ? policy.reasonCodes.filter((c): c is string => typeof c === "string")
    : [];

  const notional =
    typeof payload.notionalUsdc === "number" && Number.isFinite(payload.notionalUsdc)
      ? payload.notionalUsdc
      : null;

  const agent = agentFieldsFromSnapshot(policy);
  const routingMeta = extractRoutingFromDetails(policy);
  const executionPath = routingExecutionPathCopy(routingMeta);
  const linkProtect = shouldLinkProtectStatus(routingMeta);
  const chainId = routingMeta?.chainId ?? depsChainIdFallback(policy);

  const protectStatusUrls = linkProtect
    ? fillTxHashes
        .map((hash) => {
          const url = flashbotsProtectStatusUrl(hash, chainId);
          return url ? { txHash: hash, url } : null;
        })
        .filter((x): x is { txHash: string; url: string } => x != null)
    : [];

  const primaryProtectHash = fillTxHashes[0] ?? asOptionalString(base.txHash) ?? null;
  const protectStatusUrl =
    linkProtect && primaryProtectHash
      ? flashbotsProtectStatusUrl(primaryProtectHash, chainId)
      : null;

  const auditFields = publicExecutionAuditFields(parseExecutionAuditFromPayload(payload));

  return {
    ...base,
    strategy: asOptionalString(payload.strategy),
    notionalUsdc: notional,
    signalType: asOptionalString(signal?.type),
    legs,
    reasonCodes: reasonFromPolicy,
    fillsCount: rawFills.length,
    fillTxHashes,
    agentThesis: agent.thesis,
    agentConfidence: agent.confidence,
    agentAction: agent.action,
    routing: routingMeta?.routing ?? null,
    routingStrict: routingMeta?.routingStrict ?? null,
    routingProvider: routingMeta?.routingProvider ?? null,
    executionPath,
    protectStatusUrl,
    protectStatusUrls: protectStatusUrls.length > 0 ? protectStatusUrls : null,
    executionAudit: auditFields.executionAudit ?? null,
    executionAuditSummary: auditFields.executionAuditSummary ?? null,
    gasUsed: auditFields.gasUsed ?? null,
    gasUsedWei: auditFields.gasUsedWei ?? null,
  };
}

function depsChainIdFallback(policy: Record<string, unknown>): number {
  if (typeof policy.chainId === "number" && Number.isFinite(policy.chainId)) {
    return policy.chainId;
  }
  return 11_155_111;
}

export function toPremiumTicket(row: DeskTicketRow): PremiumDeskTicketDetail {
  return {
    ...toPublicTicket(row),
    payload:
      row.payload && typeof row.payload === "object"
        ? (row.payload as Record<string, unknown>)
        : {},
  };
}

export function toPublicCapitalMove(row: DeskCapitalMoveRow): PublicCapitalMove {
  return {
    id: row.id,
    direction: row.direction,
    amountUsdc: row.amount_usdc,
    fromAddress: row.from_address,
    toAddress: row.to_address,
    txHash: row.tx_hash,
    explorerUrl: row.explorer_url,
    registryTxHash: row.registry_tx_hash,
    registryExplorerUrl: row.registry_explorer_url,
    keeperHubRunId: row.keeper_hub_run_id,
    reason: row.reason,
    treasuryUsdcAfter: row.treasury_usdc_after,
    deskEquityAfter: row.desk_equity_after,
    createdAt: row.created_at,
  };
}

function featuresFromSignal(row: DeskSignalRow): Record<string, unknown> {
  return row.features && typeof row.features === "object"
    ? (row.features as Record<string, unknown>)
    : {};
}

function inventoryFromMark(mark: DeskPositionMark): StrategyInventory {
  const aave = mark.aave;
  // Prefer exact aEthLINK balance; fall back to collateralUsd/price estimate.
  let aaveLinkSupplied: number | undefined;
  if (aave.aLinkSupplied != null && Number.isFinite(aave.aLinkSupplied) && aave.aLinkSupplied > 0) {
    aaveLinkSupplied = aave.aLinkSupplied;
  } else {
    const linkUsd = mark.linkUsd;
    if (linkUsd != null && linkUsd > 0 && aave.totalDebtUsd < 0.01 && aave.totalCollateralUsd > 0) {
      aaveLinkSupplied = aave.totalCollateralUsd / linkUsd;
    }
  }
  return {
    freeUsdc: mark.usdc,
    freeLink: mark.link,
    freeWeth: mark.weth,
    linkUsdPrice: mark.linkUsd ?? null,
    ethUsdPrice: mark.ethUsd ?? null,
    totalCollateralUsd: aave.totalCollateralUsd,
    totalDebtUsd: aave.totalDebtUsd,
    deskEquityUsdc: mark.equityUsdc,
    ...(aaveLinkSupplied != null ? { aaveLinkSupplied } : {}),
  };
}

function applyMaintenanceOverrideFromMark(
  proposal: import("@chronicleai/schemas").DeskAgentProposal,
  mark: DeskPositionMark | null,
  config: DeskPolicyConfig,
  paused: boolean,
  killSwitchArmed: boolean,
): import("@chronicleai/schemas").DeskAgentProposal {
  if (!mark || proposal.action === "defend" || proposal.forceDefendOverride) {
    return proposal;
  }
  const inv = inventoryFromMark(mark);
  return applyForceMaintenanceOverride(proposal, {
    freeUsdc: inv.freeUsdc,
    minFreeUsdc: config.minFreeUsdc,
    aaveLinkSupplied: inv.aaveLinkSupplied ?? 0,
    freeLink: inv.freeLink ?? mark.link ?? 0,
    linkUsdPrice: inv.linkUsdPrice,
    totalCollateralUsd: inv.totalCollateralUsd,
    totalDebtUsd: inv.totalDebtUsd,
    maintenanceNotionalUsdc: config.maintenanceNotionalUsdc,
    maxTradeUsdc: config.maxTradeUsdc,
    paused,
    killSwitchArmed,
  });
}

function gasRegimeFromFeatures(
  features: Record<string, unknown>,
  classify: (gwei: number | null | undefined) => GasRegime,
): GasRegime {
  const regime = features.gasRegime;
  if (regime === "normal" || regime === "elevated" || regime === "critical") {
    return regime;
  }
  const gwei = asNumber(features.gasGwei);
  return classify(gwei);
}

function toPublicAgentSummary(
  proposal: DeskAgentProposal,
  meta: {
    createdAt: string | null;
    intentId: string | null;
    errorMessage: string | null;
  },
): PublicDeskAgentSummary {
  return {
    action: proposal.action,
    strategy: proposal.strategy,
    notionalUsdc: proposal.notionalUsdc,
    confidence: proposal.confidence,
    thesis: proposal.thesis,
    priority: proposal.priority,
    declineReasons: proposal.declineReasons ?? [],
    riskNotes: proposal.riskNotes ?? [],
    forceDefendOverride: Boolean(proposal.forceDefendOverride),
    forceMaintenanceOverride: Boolean(proposal.forceMaintenanceOverride),
    model: proposal.model ?? null,
    latencyMs: proposal.latencyMs ?? null,
    createdAt: meta.createdAt,
    intentId: meta.intentId,
    errorMessage: meta.errorMessage,
  };
}

function summaryFromAgentRunRow(row: DeskAgentRunRow): PublicDeskAgentSummary | null {
  if (!isDeskAgentProposal(row.proposal)) return null;
  return toPublicAgentSummary(row.proposal, {
    createdAt: row.created_at,
    intentId: row.intent_id,
    errorMessage: row.error_message,
  });
}

export function createDeskControlPlane(deps: DeskControlPlaneDeps): DeskControlPlane {
  const deskAddress = deps.deskWalletAddress?.trim().toLowerCase() || null;
  const treasuryAddress = deps.treasuryWalletAddress?.trim().toLowerCase() || null;
  const agentConfig: DeskAgentControlConfig = deps.agentConfig ?? {
    llmConfigured: false,
    maxSignals: 15,
    minConfidence: 0.35,
    forceDefendOnCriticalHf: true,
  };

  function agentBlockedReason(): string | null {
    // LLM is hardwired — no env off-switch. Fail closed only when stack is incomplete.
    if (!deps.agent) return "agent_not_wired";
    if (!agentConfig.llmConfigured) return "no_llm_provider_configured";
    return null;
  }

  function agentPathLive(): boolean {
    return agentBlockedReason() === null;
  }

  /**
   * Process-local last agent summary cache. Durable source of truth is
   * desk_agent_runs; this only avoids a round-trip and covers brief DB blips.
   */
  let lastAgentMemory: PublicDeskAgentSummary | null = null;

  async function syncAlertCausalMetadata(
    signal: DeskSignalRow | null | undefined,
    metadata: {
      policyVerdict?: DeskPolicyVerdict | null;
      actionStatus?: AlertActionStatus;
      intentId?: string | null;
      ticketId?: string | null;
      actionTransactionHash?: string | null;
      actionKeeperHubRunId?: string | null;
      actionExplorerUrl?: string | null;
    },
    /** Explicit Alert id when no signal linkage exists (capital / microtrade). */
    explicitAlertId?: string | null,
  ): Promise<void> {
    let alertId = explicitAlertId?.trim() || signal?.source_alert_id?.trim() || null;

    // Fallback: resolve by intent/ticket when the Signal has no source_alert_id.
    if (!alertId && deps.deskTriggerAlerts) {
      try {
        if (metadata.intentId) {
          const byIntent = await deps.deskTriggerAlerts.findByIntentId(metadata.intentId);
          if (byIntent) alertId = byIntent.id;
        }
        if (!alertId && metadata.ticketId) {
          const byTicket = await deps.deskTriggerAlerts.findByTicketId(metadata.ticketId);
          if (byTicket) alertId = byTicket.id;
        }
      } catch {
        // non-fatal lookup
      }
    }

    if (!alertId) return;

    if (deps.deskTriggerAlerts && metadata.actionStatus) {
      try {
        await deps.deskTriggerAlerts.updateAfterExecution(alertId, {
          ...metadata,
          actionStatus: metadata.actionStatus,
        });
        return;
      } catch (error) {
        deskLog.warn("desk-trigger alert update failed", {
          alertId,
          signalId: signal?.id ?? null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const alertRepo = deps.alertRepo;
    const updateCausalMetadata = alertRepo?.updateCausalMetadata;
    if (!alertRepo || !updateCausalMetadata) return;

    try {
      const result = await updateCausalMetadata.call(alertRepo, alertId, metadata);
      if (!result.ok) {
        deskLog.warn("alert causal update rejected", {
          alertId,
          signalId: signal?.id ?? null,
          error: result.error.message,
        });
      }
    } catch (error) {
      // Causal projection is observability. It must never authorize, cancel,
      // or otherwise change the execution path of an already-evaluated intent.
      deskLog.warn("alert causal update failed", {
        alertId,
        signalId: signal?.id ?? null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function safeMark(persist: boolean): Promise<{
    mark: DeskPositionMark | null;
    markError?: string;
  }> {
    if (!deps.positions || !deskAddress) {
      return {
        mark: null,
        markError: deskAddress
          ? "Position service not configured (RPC_URL required)"
          : "DESK_WALLET_ADDRESS is not configured",
      };
    }
    try {
      const mark = await deps.positions.mark({ persist, deskAddress });
      return { mark };
    } catch (error) {
      return {
        mark: null,
        markError: error instanceof Error ? error.message : "Failed to mark desk positions",
      };
    }
  }

  /**
   * Fresh on-chain USDC balance of the desk wallet at execution time.
   * Marks can lag a spent wallet (freeUsdc in the agent context is the last
   * mark), so rotate-in sizing is re-capped against this live read to avoid
   * Uniswap 'STF' safe-transfer reverts when the wallet cannot cover the
   * sized swap. Soft-fails to undefined (fall back to mark sizing).
   */
  async function liveDeskUsdcBalance(): Promise<number | undefined> {
    if (!deps.positions || !deskAddress) return undefined;
    try {
      const balances = await deps.positions.readTokenBalances(deskAddress);
      return Number.isFinite(balances.usdc) ? balances.usdc : undefined;
    } catch {
      return undefined;
    }
  }

  async function lastMoveAt(direction: "topup" | "sweep"): Promise<string | null> {
    const result = await deps.capitalMoves.findLatestByDirection(direction);
    if (!result.ok) throw result.error;
    return result.value?.created_at ?? null;
  }

  /**
   * P2-2: single open-intent query + group-by strategy (no N+1 hasOpenForStrategy).
   */
  async function buildOpenByStrategy(): Promise<Partial<Record<DeskStrategy, boolean>>> {
    const openRows = await deps.intents.listOpen(50);
    const open: Partial<Record<DeskStrategy, boolean>> = {};
    for (const strategy of DESK_STRATEGIES) {
      open[strategy] = false;
    }
    for (const row of openRows) {
      const strategy = row.strategy as DeskStrategy;
      if (strategy in open || DESK_STRATEGIES.includes(strategy)) {
        open[strategy] = true;
      }
    }
    return open;
  }

  async function lastFailedAtByStrategy(): Promise<Partial<Record<DeskStrategy, number>>> {
    const recent = await deps.intents.listRecent(50);
    const map: Partial<Record<DeskStrategy, number>> = {};
    for (const row of recent) {
      if (row.status !== "failed") continue;
      const strategy = row.strategy as DeskStrategy;
      if (map[strategy] != null) continue;
      map[strategy] = new Date(row.updated_at).getTime();
    }
    return map;
  }

  /**
   * P2-2: parallelize independent reads for agent context snapshot.
   */
  async function buildAgentContext(signalLimit: number): Promise<DeskAgentContext> {
    const [markBundle, signalsResult, intents, capitalResult, openByStrategy] = await Promise.all([
      safeMark(false),
      deps.signals.listRecent(signalLimit),
      deps.intents.listRecent(20),
      deps.capitalMoves.listRecent(10),
      buildOpenByStrategy(),
    ]);

    if (!signalsResult.ok) throw signalsResult.error;
    if (!capitalResult.ok) throw capitalResult.error;

    const { mark } = markBundle;

    const lastFailedByStrategy: DeskAgentContext["lastFailedByStrategy"] = {};
    for (const row of intents) {
      if (row.status !== "failed") continue;
      const strategy = row.strategy as DeskStrategy;
      if (lastFailedByStrategy[strategy]) continue;
      lastFailedByStrategy[strategy] = {
        id: row.id,
        errorMessage: row.error_message,
        at: row.updated_at,
      };
    }

    let gasRegime: GasRegime = "normal";
    let gasGwei: number | null = null;
    for (const s of signalsResult.value) {
      const features = featuresFromSignal(s);
      if (
        features.gasRegime === "normal" ||
        features.gasRegime === "elevated" ||
        features.gasRegime === "critical"
      ) {
        gasRegime = features.gasRegime;
      }
      const g = asNumber(features.gasGwei);
      if (g != null) gasGwei = g;
      if (gasRegime !== "normal" || gasGwei != null) break;
    }

    const capitalMoves = capitalResult.value.map((m) => ({
      id: m.id,
      direction: m.direction,
      amountUsdc: m.amount_usdc,
      reason: m.reason,
      createdAt: m.created_at,
    }));
    const lastMove = capitalMoves[0];

    const aave = mark?.aave;
    const inv = mark ? inventoryFromMark(mark) : null;
    return {
      chainId: deps.chainId,
      deskWalletAddress: deskAddress,
      mark: {
        asOf: mark?.asOf ?? null,
        equityUsdc: mark?.equityUsdc ?? null,
        freeUsdc: mark?.usdc ?? null,
        freeWeth: mark?.weth ?? null,
        freeLink: mark?.link ?? null,
        healthFactor: aave?.healthFactor ?? null,
        totalCollateralUsd: aave?.totalCollateralUsd ?? null,
        totalDebtUsd: aave?.totalDebtUsd ?? null,
        ethUsd: mark?.ethUsd ?? null,
        linkUsd: mark?.linkUsd ?? null,
        ...(inv?.aaveLinkSupplied != null ? { aaveLinkSupplied: inv.aaveLinkSupplied } : {}),
      },
      policy: {
        maxTradeUsdc: deps.config.maxTradeUsdc,
        minAumUsdc: deps.config.minAumUsdc,
        targetAumUsdc: deps.config.targetAumUsdc,
        maxAumUsdc: deps.config.maxAumUsdc,
        hfWarn: deps.config.hfWarn,
        hfCritical: deps.config.hfCritical,
        basisBps: deps.config.basisBps,
        apyDeltaBps: deps.config.apyDeltaBps,
        apyConsecutivePolls: deps.config.apyConsecutivePolls,
        oracleMaxStalenessMs: deps.config.oracleMaxStalenessMs,
        trustTestnetSignals: deps.config.trustTestnetSignals === true,
        minFreeUsdc: deps.config.minFreeUsdc,
        maintenanceNotionalUsdc: deps.config.maintenanceNotionalUsdc,
        paused: deps.getDeskPaused() || deps.config.paused,
        killSwitchArmed: deps.killSwitch.isArmed(),
        gasRegime,
        forceDefendOnCriticalHf: agentConfig.forceDefendOnCriticalHf,
        minConfidence: agentConfig.minConfidence,
      },
      signals: signalsResult.value.map((s) => {
        const features = featuresFromSignal(s);
        const fusion =
          typeof features.fusionLabel === "string"
            ? (features.fusionLabel as DeskAgentContext["signals"][number]["fusionLabel"])
            : undefined;
        return {
          id: s.id,
          signalType: s.signal_type,
          severity: s.severity,
          policyVerdict: s.policy_verdict,
          features,
          createdAt: s.created_at,
          ...(fusion ? { fusionLabel: fusion } : {}),
        };
      }),
      intents: intents.map((i) => ({
        id: i.id,
        strategy: i.strategy,
        status: i.status,
        notionalUsdc: i.notional_usdc,
        reasonCodes: i.reason_codes ?? [],
        errorMessage: i.error_message,
        createdAt: i.created_at,
      })),
      openByStrategy,
      lastFailedByStrategy,
      capitalMoves,
      lastCapitalSummary: lastMove
        ? `${lastMove.direction} ${lastMove.amountUsdc} USDC${lastMove.reason ? ` (${lastMove.reason})` : ""}`
        : null,
      gasRegime,
      gasGwei,
    };
  }

  async function softAppendExecLog(opts: {
    status: ExecutionLogStatus;
    message: string;
    entityType?: string | null;
    entityId?: string | null;
    details?: Record<string, unknown>;
    startedAt?: string;
    completedAt?: string | null;
  }): Promise<void> {
    if (!deps.execLogRepo) return;
    const startedAt = opts.startedAt ?? new Date().toISOString();
    const terminal = opts.status === "succeeded" || opts.status === "failed";
    try {
      const result = await deps.execLogRepo.append({
        action_type: "desk_agent",
        entity_type: opts.entityType ?? "desk",
        entity_id: opts.entityId ?? null,
        status: opts.status,
        message: opts.message,
        details: opts.details ?? {},
        started_at: startedAt,
        completed_at: opts.completedAt ?? (terminal ? new Date().toISOString() : null),
      });
      if (!result.ok) {
        console.error(
          "[desk] execution_log append failed:",
          result.error.message,
          result.error.code,
        );
      }
    } catch (error) {
      console.error(
        "[desk] execution_log append threw:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  async function persistAgentRun(opts: {
    proposal: DeskAgentProposal;
    context: DeskAgentContext;
    errorMessage?: string | undefined;
    latencyMs: number;
  }): Promise<string | null> {
    lastAgentMemory = toPublicAgentSummary(opts.proposal, {
      createdAt: new Date().toISOString(),
      intentId: null,
      errorMessage: opts.errorMessage ?? null,
    });
    if (!deps.agentRuns) {
      // Deliberate no-op when repo not wired (tests / partial bootstrap).
      // Production always wires agentRuns via routes/index.ts.
      return null;
    }
    try {
      const result = await deps.agentRuns.create({
        model: opts.proposal.model ?? null,
        latency_ms: opts.latencyMs,
        proposal: opts.proposal as unknown as Record<string, unknown>,
        context_digest: {
          ...contextDigest(opts.context),
          forceMaintenance: Boolean(opts.proposal.forceMaintenanceOverride),
          forceDefend: Boolean(opts.proposal.forceDefendOverride),
          agentAction: opts.proposal.action,
          agentStrategy: opts.proposal.strategy,
          notionalUsdc: opts.proposal.notionalUsdc,
        },
        error_message: opts.errorMessage ?? null,
      });
      if (!result.ok) {
        console.error(
          "[desk-agent] desk_agent_runs insert failed:",
          result.error.message,
          result.error.code,
          {
            action: opts.proposal.action,
            strategy: opts.proposal.strategy,
            latencyMs: opts.latencyMs,
          },
        );
        await softAppendExecLog({
          status: "failed",
          message: `desk_agent_runs insert failed: ${result.error.message}`,
          entityType: "desk_agent_run",
          details: {
            phase: "persist_agent_run",
            reason: "insert_failed",
            errorCode: result.error.code,
            errorMessage: result.error.message,
            action: opts.proposal.action,
            strategy: opts.proposal.strategy,
            model: opts.proposal.model ?? null,
            latencyMs: opts.latencyMs,
          },
        });
        return null;
      }
      lastAgentMemory = toPublicAgentSummary(opts.proposal, {
        createdAt: result.value.created_at,
        intentId: result.value.intent_id,
        errorMessage: result.value.error_message,
      });
      await softAppendExecLog({
        status: "succeeded",
        message: `Agent ${opts.proposal.action}${opts.proposal.strategy ? ` (${opts.proposal.strategy})` : ""} persisted`,
        entityType: "desk_agent_run",
        entityId: result.value.id,
        details: {
          phase: "persist_agent_run",
          action: opts.proposal.action,
          strategy: opts.proposal.strategy,
          model: opts.proposal.model ?? null,
          latencyMs: opts.latencyMs,
          confidence: opts.proposal.confidence,
          forceMaintenanceOverride: opts.proposal.forceMaintenanceOverride ?? false,
          errorMessage: opts.errorMessage ?? null,
        },
      });
      return result.value.id;
    } catch (error) {
      console.error(
        "[desk-agent] desk_agent_runs insert threw:",
        error instanceof Error ? error.message : error,
        {
          action: opts.proposal.action,
          strategy: opts.proposal.strategy,
          latencyMs: opts.latencyMs,
        },
      );
      await softAppendExecLog({
        status: "failed",
        message: `desk_agent_runs insert threw: ${error instanceof Error ? error.message : String(error)}`,
        entityType: "desk_agent_run",
        details: {
          phase: "persist_agent_run",
          reason: "insert_threw",
          errorMessage: error instanceof Error ? error.message : String(error),
          action: opts.proposal.action,
          strategy: opts.proposal.strategy,
          latencyMs: opts.latencyMs,
        },
      });
      return null;
    }
  }

  async function linkAgentRunToIntent(agentRunId: string | null, intentId: string) {
    if (!agentRunId || !deps.agentRuns) return;
    try {
      const result = await deps.agentRuns.linkIntent(agentRunId, intentId);
      if (!result.ok) {
        console.error("[desk-agent] linkIntent failed:", result.error.message, result.error.code, {
          agentRunId,
          intentId,
        });
        return;
      }
      if (lastAgentMemory) {
        lastAgentMemory = { ...lastAgentMemory, intentId };
      }
    } catch (error) {
      console.error(
        "[desk-agent] linkIntent threw:",
        error instanceof Error ? error.message : error,
        { agentRunId, intentId },
      );
    }
  }

  function normalizeIncomingProposal(
    raw: unknown,
    mark: DeskPositionMark | null,
  ): DeskAgentProposal | null {
    if (!isDeskAgentProposal(raw)) return null;
    let proposal = applyMinConfidence(raw, agentConfig.minConfidence);
    const paused = deps.getDeskPaused() || deps.config.paused;
    const killArmed = deps.killSwitch.isArmed();
    proposal = applyForceDefendOverride(proposal, {
      healthFactor: mark?.aave.healthFactor ?? null,
      hfCritical: deps.config.hfCritical,
      paused,
      forceDefendEnabled: agentConfig.forceDefendOnCriticalHf,
    });
    proposal = applyMaintenanceOverrideFromMark(proposal, mark, deps.config, paused, killArmed);
    return proposal;
  }

  async function loadLastMaintenanceAtMs(): Promise<number | null> {
    if (!deps.controlState) return null;
    try {
      const result = await deps.controlState.get();
      if (!result.ok) return null;
      const raw = result.value.last_maintenance_at;
      if (!raw) return null;
      const ms = Date.parse(raw);
      return Number.isFinite(ms) ? ms : null;
    } catch {
      return null;
    }
  }

  async function touchLastMaintenanceAt(reasonCodes: readonly string[]) {
    if (!deps.controlState) return;
    // Inline check avoids circular import weight; mirrors isMaintenanceReasonCodes.
    const isMaint = reasonCodes.some(
      (c) =>
        c === "maintenance_rebalance" ||
        c === "free_usdc_shortfall" ||
        c === "apy_data_quality_hold_inventory" ||
        c === "event_linked_microtrade" ||
        c.startsWith("maintenance_") ||
        c.startsWith("event_linked_microtrade"),
    );
    if (!isMaint) return;
    try {
      await deps.controlState.upsert({
        last_maintenance_at: new Date().toISOString(),
      });
    } catch {
      // non-fatal — cadence may re-fire sooner
    }
  }

  async function loadLastEventMicrotradeAtMs(): Promise<number | null> {
    if (!deps.controlState) return null;
    try {
      const result = await deps.controlState.get();
      if (!result.ok) return null;
      const raw = result.value.last_event_microtrade_at;
      if (!raw) return null;
      const ms = Date.parse(raw);
      return Number.isFinite(ms) ? ms : null;
    } catch {
      return null;
    }
  }

  async function touchLastEventMicrotradeAt() {
    if (!deps.controlState) return;
    try {
      await deps.controlState.upsert({
        last_event_microtrade_at: new Date().toISOString(),
      });
    } catch {
      // non-fatal — cooldown may re-fire sooner
    }
  }

  async function loadEventMicrotradeTriggers(
    lookbackMs: number,
    nowMs: number,
  ): Promise<EventMicrotradeTrigger[]> {
    if (!deps.monitoredEvents) return [];
    const periodEnd = new Date(nowMs).toISOString();
    const periodStart = new Date(nowMs - lookbackMs).toISOString();
    try {
      // Prefer qualified newspaper events (alert path). Fall back to any status
      // in-window if listInWindow with status returns empty (status filter optional).
      const qualified = await deps.monitoredEvents.listInWindow({
        periodStart,
        periodEnd,
        status: "qualified",
        limit: 50,
      });
      let rows: MonitoredEventRow[] = [];
      if (qualified.ok) {
        rows = qualified.value.filter(
          (r) =>
            isEventMicrotradeTriggerType(r.event_type) &&
            (r.event_type !== "gas_spike" || r.chain_id === ACTIVE_INTELLIGENCE_CHAIN_ID),
        );
      }
      if (rows.length === 0) {
        // listInWindow without status (e.g. status column filter unavailable)
        // still only accepts qualified events for microtrade authorization.
        const anyStatus = await deps.monitoredEvents.listInWindow({
          periodStart,
          periodEnd,
          limit: 50,
        });
        if (anyStatus.ok) {
          rows = anyStatus.value.filter(
            (r) =>
              isEventMicrotradeTriggerType(r.event_type) &&
              r.status === "qualified" &&
              (r.event_type !== "gas_spike" || r.chain_id === ACTIVE_INTELLIGENCE_CHAIN_ID),
          );
        }
      }
      // Newest first
      rows = [...rows].sort(
        (a, b) =>
          Date.parse(b.captured_at || b.created_at) - Date.parse(a.captured_at || a.created_at),
      );
      return rows.map((r) => ({
        monitoredEventId: r.id,
        eventType: r.event_type,
        capturedAt: r.captured_at || r.created_at,
        transactionHash: r.transaction_hash,
        sourceChainId: r.chain_id,
        source: "monitored_event" as const,
      }));
    } catch (error) {
      console.warn(
        "[desk-event-microtrade] load triggers failed:",
        error instanceof Error ? error.message : error,
      );
      return [];
    }
  }

  return {
    getConfig: () => deps.config,
    getDeskWalletAddress: () => deskAddress,
    getTreasuryWalletAddress: () => treasuryAddress,
    getKillState: () => deps.killSwitch.getState(),
    isAgentEnabled: () => agentPathLive(),
    getAgentBlockedReason: () => agentBlockedReason(),

    async markLive(persist = false) {
      if (!deps.positions || !deskAddress) {
        throw new Error(
          deskAddress ? "Position service not configured" : "DESK_WALLET_ADDRESS is not configured",
        );
      }
      return deps.positions.mark({ persist, deskAddress });
    },

    async getLatestPosition() {
      if (!deps.positions) return null;
      return deps.positions.getLatest(deskAddress ?? undefined);
    },

    async listIntents(limit = 50) {
      return deps.intents.listRecent(limit);
    },

    async listIntentsPage(params) {
      return deps.intents.listPage(params);
    },

    async listTickets(limit = 50) {
      return deps.tickets.listRecent(limit);
    },

    async listTicketsPage(params) {
      return deps.tickets.listPage(params);
    },

    async getTicket(id) {
      return deps.tickets.findById(id);
    },

    async findTicketBySignalHash(signalHash) {
      return deps.tickets.findBySignalHash(signalHash);
    },

    async findTicketByIntentId(intentId) {
      return deps.tickets.findByIntentId(intentId);
    },

    async listCapitalMoves(limit = 50) {
      const result = await deps.capitalMoves.listRecent(limit);
      if (!result.ok) throw result.error;
      return result.value;
    },

    async listCapitalMovesPage(params) {
      const result = await deps.capitalMoves.listPage(params);
      if (!result.ok) throw result.error;
      return result.value;
    },

    async getStatus() {
      const heartbeat = await deps.heartbeats.getStatus();
      let equityUsdc: number | null = null;
      let freeUsdc: number | null = null;
      let healthFactor: number | null = null;
      let lastPositionAsOf: string | null = null;

      const latest = await this.getLatestPosition();
      if (latest) {
        equityUsdc = latest.equity_usdc;
        freeUsdc = latest.usdc;
        lastPositionAsOf = latest.as_of;
        const aave =
          latest.aave && typeof latest.aave === "object"
            ? (latest.aave as Record<string, unknown>)
            : null;
        healthFactor = normalizePublicHealthFactor(aave);
      }

      const [lastTopupAt, lastSweepAt] = await Promise.all([
        lastMoveAt("topup"),
        lastMoveAt("sweep"),
      ]);

      let lastAgent = lastAgentMemory;
      if (!lastAgent && deps.agentRuns) {
        try {
          const latest = await deps.agentRuns.findLatest();
          if (latest.ok && latest.value) {
            lastAgent = summaryFromAgentRunRow(latest.value);
            lastAgentMemory = lastAgent;
          }
        } catch {
          // ignore
        }
      }

      const privateRouting = deps.routingPolicyEnv
        ? publicPrivateRoutingStatus({
            ...deps.routingPolicyEnv,
            chainId: deps.routingPolicyEnv.chainId ?? deps.chainId,
          })
        : null;

      return {
        chainId: deps.chainId,
        deskWalletAddress: deskAddress,
        treasuryWalletAddress: treasuryAddress,
        equityUsdc,
        freeUsdc,
        targetAumUsdc: deps.config.targetAumUsdc,
        maxAumUsdc: deps.config.maxAumUsdc,
        minAumUsdc: deps.config.minAumUsdc,
        healthFactor,
        paused: deps.getDeskPaused() || deps.config.paused,
        killSwitch: deps.killSwitch.getState(),
        heartbeat,
        lastPositionAsOf,
        lastTopupAt,
        lastSweepAt,
        policy: {
          maxTradeUsdc: deps.config.maxTradeUsdc,
          hfWarn: deps.config.hfWarn,
          hfCritical: deps.config.hfCritical,
          basisBps: deps.config.basisBps,
          apyDeltaBps: deps.config.apyDeltaBps,
        },
        privateRouting,
        lastAgent,
        agentEnabled: agentPathLive(),
        agentBlockedReason: agentBlockedReason(),
      };
    },

    async getLatestAgent() {
      if (lastAgentMemory) return lastAgentMemory;
      if (deps.agentRuns) {
        const latest = await deps.agentRuns.findLatest();
        if (latest.ok && latest.value) {
          lastAgentMemory = summaryFromAgentRunRow(latest.value);
          return lastAgentMemory;
        }
      }
      return null;
    },

    async runAgentOnly(body = {}) {
      const signalLimit = Math.min(
        50,
        Math.max(1, asNumber(body.signalLimit) ?? agentConfig.maxSignals),
      );
      const context = await buildAgentContext(signalLimit);
      const blocked = agentBlockedReason();

      // Fail closed: no LLM path → hold (force-defend may still upgrade).
      // There is no legacy signal→intent bypass when the agent is offline.
      if (blocked) {
        const hold: DeskAgentProposal = {
          version: 1,
          action: "hold",
          strategy: null,
          notionalUsdc: 0,
          priority: 0,
          confidence: 0,
          thesis:
            blocked === "no_llm_provider_configured"
              ? "No LLM API key configured — strategy trading fail-closed; only code force-defend may open."
              : "Desk agent not wired — strategy trading fail-closed; only code force-defend may open.",
          riskNotes: [],
          legsHint: ["none"],
          declineReasons: [blocked, "llm_path_mandatory"],
        };
        const forced = applyForceDefendOverride(hold, {
          healthFactor: context.mark.healthFactor,
          hfCritical: deps.config.hfCritical,
          paused: context.policy.paused,
          forceDefendEnabled: agentConfig.forceDefendOnCriticalHf,
        });
        const agentRunId = await persistAgentRun({
          proposal: forced,
          context,
          errorMessage: blocked,
          latencyMs: 0,
        });
        return {
          proposal: forced,
          agentRunId,
          context,
          safeDefault: true,
          errorMessage: blocked,
        };
      }

      if (!deps.agent) {
        throw new Error("Desk agent unavailable after mandatory-path preflight");
      }
      const result = await deps.agent.run(context);
      const agentRunId = await persistAgentRun({
        proposal: result.proposal,
        context,
        errorMessage: result.errorMessage,
        latencyMs: result.latencyMs,
      });
      return {
        proposal: result.proposal,
        agentRunId,
        context,
        safeDefault: result.safeDefault,
        errorMessage: result.errorMessage,
      };
    },

    async runCapitalTick(body = {}) {
      const { mark, markError } = await safeMark(true);

      const bodyEquity = asNumber(body.deskEquityUsdc);
      const bodyFree = asNumber(body.freeUsdcOnDesk);
      const bodyTreasuryUsdc = asNumber(body.treasuryUsdc);
      const bodyTreasuryEth = asNumber(body.treasuryEthBalance);
      const bodyTreasuryBaseUsdc = asNumber(body.treasuryBaseUsdc);

      let treasuryUsdc = bodyTreasuryUsdc ?? null;
      let treasuryEth = bodyTreasuryEth ?? null;
      let treasuryBaseUsdc = bodyTreasuryBaseUsdc ?? null;

      if (treasuryUsdc == null || treasuryEth == null) {
        const live = await deps.loadTreasuryBalances();
        if (live) {
          treasuryUsdc = treasuryUsdc ?? live.usdcBalance;
          treasuryEth = treasuryEth ?? live.ethBalance;
        }
      }

      if (treasuryBaseUsdc == null && deps.loadDualRailTreasuryBalances) {
        try {
          const dual = await deps.loadDualRailTreasuryBalances();
          if (dual) {
            treasuryBaseUsdc = dual.treasuryBaseUsdc;
            // Prefer dual-rail Sepolia read when body did not override.
            if (bodyTreasuryUsdc == null && Number.isFinite(dual.treasurySepoliaUsdc)) {
              treasuryUsdc = dual.treasurySepoliaUsdc;
            }
          }
        } catch (error) {
          console.warn(
            "[desk.capital] dual-rail balance load failed:",
            error instanceof Error ? error.message : error,
          );
        }
      }

      if (treasuryUsdc == null) {
        return {
          mark,
          markError: markError ?? undefined,
          treasuryUsdc: null,
          treasuryEth,
          treasuryBaseUsdc,
          capital: {
            decision: {
              action: "none" as const,
              amountUsdc: 0,
              reason: "treasury_usdc_unavailable",
            },
            errorMessage:
              "Treasury USDC balance unavailable — provide treasuryUsdc in body or configure RPC/Para",
          },
        };
      }

      const deskEquityUsdc = bodyEquity ?? mark?.equityUsdc ?? 0;
      const freeUsdcOnDesk = bodyFree ?? mark?.usdc ?? 0;

      const lastTopup = await deps.capitalMoves.findLatestByDirection("topup");
      if (!lastTopup.ok) throw lastTopup.error;
      const lastTopupAtMs = lastTopup.value ? new Date(lastTopup.value.created_at).getTime() : null;

      if (!deps.capitalManager) {
        return {
          mark,
          markError: markError ?? undefined,
          treasuryUsdc,
          treasuryEth,
          treasuryBaseUsdc,
          capital: {
            decision: {
              action: "none" as const,
              amountUsdc: 0,
              reason: "capital_manager_not_configured",
            },
            errorMessage:
              "Capital manager not configured (DESK_WALLET_ADDRESS + treasury transfer path)",
          },
        };
      }

      const bodyFreeLink = asNumber(body.freeLinkOnDesk);
      const bodyLinkUsd = asNumber(body.linkUsdPrice);
      const bodyAaveCollateral = asNumber(body.aaveTotalCollateralUsd);
      const bodyAaveDebt = asNumber(body.aaveTotalDebtUsd);
      const bodyAaveLink = asNumber(body.aaveLinkSupplied);

      // Anti-thrash: recent sweeps interleaved with free-powder maintenance fills.
      let lastFreePowderFillAtMs: number | null = null;
      let suppressMaxAumSweep = false;
      try {
        const [movesResult, recentIntents] = await Promise.all([
          deps.capitalMoves.listRecent(8),
          deps.intents.listRecent(20),
        ]);
        const moves = movesResult.ok ? movesResult.value : [];
        const shortfallFills = recentIntents.filter(
          (i) =>
            i.status === "filled" &&
            (i.reason_codes ?? []).some(
              (c) => c === "free_usdc_shortfall" || c.includes("free_usdc_shortfall"),
            ),
        );
        if (shortfallFills[0]) {
          lastFreePowderFillAtMs = new Date(shortfallFills[0].created_at).getTime();
          if (!Number.isFinite(lastFreePowderFillAtMs)) lastFreePowderFillAtMs = null;
        }
        const thrash = detectPowderThrash({
          recentCapitalMoves: moves.map((m) => ({
            direction: m.direction,
            reason: m.reason,
          })),
          recentFilledIntents: shortfallFills.map((i) => ({
            reasonCodes: i.reason_codes ?? [],
          })),
          window: 3,
        });
        // Pause max-AUM vacuum until free powder is actually holding.
        if (thrash && freeUsdcOnDesk + 1e-9 < deps.config.minFreeUsdc) {
          suppressMaxAumSweep = true;
          console.warn(
            `[desk.capital] desk_powder_thrash_detected — suppressing max-AUM sweeps until free USDC ≥ minFree (${deps.config.minFreeUsdc})`,
          );
          await softAppendExecLog({
            status: "succeeded",
            message: "Desk powder thrash detected — max-AUM sweeps paused",
            entityType: "desk_capital_move",
            details: {
              method: "desk_powder_thrash_detected",
              freeUsdcOnDesk,
              minFreeUsdc: deps.config.minFreeUsdc,
              deskEquityUsdc,
              recentSweepCount: moves.slice(0, 3).filter((m) => m.direction === "sweep").length,
              recentShortfallFills: shortfallFills.slice(0, 3).map((i) => i.id),
            },
          });
        }
      } catch (error) {
        console.warn(
          "[desk.capital] thrash/cooldown history load failed:",
          error instanceof Error ? error.message : error,
        );
      }

      const capitalTickInput = {
        treasuryUsdc,
        treasurySafetyBufferEth: deps.treasurySafetyBufferEth,
        treasuryEthBalance: treasuryEth ?? undefined,
        usdcOperatingReserve: deps.usdcOperatingReserve,
        deskEquityUsdc,
        freeUsdcOnDesk,
        lastTopupAtMs,
        deskPaused: deps.getDeskPaused() || deps.config.paused,
        killSwitchArmed: deps.killSwitch.isArmed(),
        ...(treasuryBaseUsdc != null ? { treasuryBaseUsdc } : {}),
        ...(deps.cctpBaseSafetyBufferUsdc != null
          ? { cctpBaseSafetyBufferUsdc: deps.cctpBaseSafetyBufferUsdc }
          : {}),
        ...(deps.cctpRebalanceThresholdUsdc != null
          ? { cctpRebalanceThresholdUsdc: deps.cctpRebalanceThresholdUsdc }
          : {}),
        topupChunkUsdc: deps.config.topupChunkUsdc,
        freeLinkOnDesk: bodyFreeLink ?? mark?.link ?? 0,
        linkUsdPrice: bodyLinkUsd ?? mark?.linkUsd ?? null,
        aaveTotalCollateralUsd: bodyAaveCollateral ?? mark?.aave.totalCollateralUsd ?? 0,
        aaveTotalDebtUsd: bodyAaveDebt ?? mark?.aave.totalDebtUsd ?? 0,
        ...(bodyAaveLink != null
          ? { aaveLinkSupplied: bodyAaveLink }
          : mark
            ? (() => {
                const inv = inventoryFromMark(mark);
                return inv.aaveLinkSupplied != null
                  ? { aaveLinkSupplied: inv.aaveLinkSupplied }
                  : {};
              })()
            : {}),
        lastFreePowderFillAtMs,
        suppressMaxAumSweep,
      };

      // Evaluate first so a Desk-trigger Alert can be created before execution.
      // Publication failure must never cancel the capital action.
      const preDecision = deps.capitalManager.decide(capitalTickInput);
      let capitalAlertId: string | null = null;
      if (deps.deskTriggerAlerts && preDecision.action !== "none") {
        try {
          const alertResult = await deps.deskTriggerAlerts.createFromCapital({
            decision: preDecision,
          });
          capitalAlertId = alertResult?.alert.id ?? null;
        } catch (error) {
          deskLog.warn("capital desk-trigger alert create failed (non-blocking)", {
            action: preDecision.action,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const capital = await deps.capitalManager.tick(capitalTickInput);

      if (capitalAlertId && deps.deskTriggerAlerts) {
        const actionStatus: AlertActionStatus = capital.errorMessage
          ? "failed"
          : capital.txHash
            ? "filled"
            : capital.decision.action === "none"
              ? "ignored"
              : "submitted";
        try {
          await deps.deskTriggerAlerts.updateAfterExecution(capitalAlertId, {
            actionStatus,
            policyVerdict: capital.decision.action === "none" ? "ignore" : "trade",
            ...(capital.txHash ? { actionTransactionHash: capital.txHash } : {}),
            ...(capital.keeperHubRunId
              ? { actionKeeperHubRunId: capital.keeperHubRunId }
              : {}),
            ...(capital.explorerUrl ? { actionExplorerUrl: capital.explorerUrl } : {}),
          });
        } catch (error) {
          deskLog.warn("capital desk-trigger alert update failed (non-blocking)", {
            alertId: capitalAlertId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (capital.decision.reason === "awaiting_cctp_rebalance") {
        // P2-10: chatty tick detail at debug; one-line summary stays available.
        capitalLog.debug("top-up deferred — awaiting CCTP rebalance", {
          sepoliaUsdc: treasuryUsdc,
          baseUsdc: treasuryBaseUsdc ?? null,
          deskEquity: deskEquityUsdc,
        });
      }

      if (capital.decision.action === "free_inventory") {
        capitalLog.info("free_inventory", {
          amount: capital.decision.amountUsdc,
          source: capital.decision.inventorySource ?? "unknown",
          tx: capital.txHash ?? "pending",
          ok: !capital.errorMessage,
          error: capital.errorMessage ?? null,
        });
      }

      return {
        mark,
        markError: markError ?? undefined,
        treasuryUsdc,
        treasuryEth,
        treasuryBaseUsdc,
        capital,
      };
    },

    async runDeskTick(body = {}) {
      const tickStartedAt = new Date().toISOString();
      const source = (asString(body.source) as DeskHeartbeatSource | undefined) ?? "api";
      const allowedSources = new Set(["api", "scheduler", "workflow"]);
      const heartbeatSource = allowedSources.has(source) ? (source as DeskHeartbeatSource) : "api";

      const heartbeat = await deps.heartbeats.touch(heartbeatSource);
      const execute = asBoolean(body.execute, false);
      const evaluateKill = asBoolean(body.evaluateKill, true);
      const signalLimit = Math.min(50, Math.max(1, asNumber(body.signalLimit) ?? 20));

      await softAppendExecLog({
        status: "started",
        message: `Desk tick started (source=${heartbeatSource}, execute=${execute})`,
        entityType: "desk_tick",
        entityId: heartbeat.id,
        startedAt: tickStartedAt,
        completedAt: null,
        details: {
          phase: "desk_tick",
          source: heartbeatSource,
          execute,
          evaluateKill,
          signalLimit,
        },
      });

      const { mark, markError } = await safeMark(true);

      const evaluations: DeskTickResult["evaluations"] = [];
      const executions: StrategyExecuteResult[] = [];

      // Mandatory LLM path: every strategy tick requires an agent proposal.
      // Body may supply a precomputed proposal (scheduler / agent-tick); otherwise run agent.
      // There is no signal→intent bypass when the agent is offline.
      let agentProposal: DeskAgentProposal | undefined;
      let agentRunId: string | undefined;
      let agentSkippedRisk = false;

      if (body.agentProposal != null) {
        const normalized = normalizeIncomingProposal(body.agentProposal, mark);
        if (normalized) agentProposal = normalized;
      }
      if (!agentProposal) {
        const agentResult = await this.runAgentOnly({
          signalLimit: asNumber(body.signalLimit) ?? agentConfig.maxSignals,
        });
        agentProposal = agentResult.proposal;
        agentRunId = agentResult.agentRunId ?? undefined;
      }

      // Force maintenance after agent path when free USDC short (hold cannot block powder).
      if (agentProposal && mark) {
        agentProposal = applyMaintenanceOverrideFromMark(
          agentProposal,
          mark,
          deps.config,
          deps.getDeskPaused() || deps.config.paused,
          deps.killSwitch.isArmed(),
        );
      }

      const mapped = mapProposalToDecision(agentProposal);
      agentSkippedRisk = mapped.skipRiskIncreasing;

      if (mark && !deps.getDeskPaused() && !deps.config.paused) {
        // P2-2: parallelize independent policy-gate reads for strategy tick.
        const [
          signalsResult,
          openByStrategy,
          lastFailedAtMsByStrategy,
          lastMaintenanceAtMs,
          hasAnyOpenIntent,
        ] = await Promise.all([
          deps.signals.listRecent(signalLimit),
          buildOpenByStrategy(),
          lastFailedAtByStrategy(),
          loadLastMaintenanceAtMs(),
          deps.intents.hasAnyOpen(),
        ]);
        if (!signalsResult.ok) throw signalsResult.error;
        const inventory = inventoryFromMark(mark);
        const killArmed = deps.killSwitch.isArmed();

        // Only agent-authorized strategies may open intents:
        // - hold/defer → none (force-defend already upgraded action to defend)
        // - defend → risk_defend only
        // - propose → preferred strategy only (incl. force-maintenance yield_rotation)
        // - force-maintenance → yield_rotation even when agent held (mapped upgrades to propose)
        const authorizedStrategies = new Set<DeskStrategy>();
        if (mapped.isDefend) {
          authorizedStrategies.add("risk_defend");
        } else if (mapped.preferredStrategy) {
          // Maintenance free-powder is risk-decreasing but still uses yield_rotation.
          authorizedStrategies.add(mapped.preferredStrategy);
        }

        const candidates: Array<{
          signal: DeskSignalRow | null;
          strategy: DeskStrategy;
          synthetic?: boolean | undefined;
          blockedReason?: string | undefined;
        }> = [];
        for (const signal of signalsResult.value) {
          if (signal.policy_verdict === "ignore" || signal.policy_verdict === "defer") {
            continue;
          }
          const strategy = strategyForSignalType(signal.signal_type);
          if (!strategy) continue;
          const evidence = signal.source_evidence ?? {};
          const sources = signal.sources ?? {};
          const eventType =
            typeof evidence.eventType === "string"
              ? evidence.eventType
              : typeof sources.eventType === "string"
                ? sources.eventType
                : undefined;
          const sourceChainId =
            asNumber(evidence.sourceChainId) ??
            asNumber(sources.sourceChainId) ??
            (eventType
              ? asNumber(evidence.chainId) ?? asNumber(sources.chainId)
              : undefined);
          let blockedReason: string | undefined;
          if (eventType === "liquidation") {
            blockedReason = "individual_liquidation_observation_only";
          } else if (
            eventType === "gas_spike" &&
            sourceChainId !== ACTIVE_INTELLIGENCE_CHAIN_ID
          ) {
            blockedReason = "mainnet_gas_context_only";
          } else if (eventType === "liquidation_cluster") {
            const healthFactor = mark.aave.healthFactor;
            if (
              healthFactor == null ||
              !Number.isFinite(healthFactor) ||
              healthFactor >= deps.config.hfWarn
            ) {
              blockedReason =
                sourceChainId === PRIMARY_SIGNAL_CHAIN_ID
                  ? "mainnet_liquidation_requires_local_sepolia_risk"
                  : "liquidation_cluster_requires_local_risk_condition";
            }
          }
          candidates.push({ signal, strategy, ...(blockedReason ? { blockedReason } : {}) });
        }

        // Force-maintenance may need yield_rotation even when APY signals were soft-deferred.
        if (
          agentProposal?.forceMaintenanceOverride &&
          mapped.preferredStrategy === "yield_rotation" &&
          !candidates.some((c) => c.strategy === "yield_rotation")
        ) {
          candidates.push({
            signal: null,
            strategy: "yield_rotation",
            synthetic: true,
          });
        }

        const strategyOrder: DeskStrategy[] = [...DESK_STRATEGIES];
        if (mapped.preferredStrategy) {
          const pref = mapped.preferredStrategy;
          strategyOrder.sort((a, b) => {
            if (a === pref) return -1;
            if (b === pref) return 1;
            return DESK_STRATEGIES.indexOf(a) - DESK_STRATEGIES.indexOf(b);
          });
        }

        const seen = new Set<DeskStrategy>();
        for (const strategy of strategyOrder) {
          if (seen.has(strategy)) continue;
          const match = candidates.find((c) => c.strategy === strategy);
          if (!match) continue;
          seen.add(strategy);

          if (match.blockedReason) {
            evaluations.push({
              signalId: match.signal?.id ?? null,
              signalType: match.signal?.signal_type ?? strategy,
              strategy,
              planAction: "deferred",
              reasonCodes: ["execution_family_gate", match.blockedReason],
            });
            await syncAlertCausalMetadata(match.signal, {
              ...(match.signal?.policy_verdict
                ? { policyVerdict: match.signal.policy_verdict }
                : {}),
              actionStatus: "deferred",
            });
            continue;
          }

          if (!authorizedStrategies.has(strategy)) {
            evaluations.push({
              signalId: match.signal?.id ?? null,
              signalType: match.signal?.signal_type ?? strategy,
              strategy,
              planAction: mapped.skipRiskIncreasing ? "agent_hold" : "agent_not_authorized",
              reasonCodes: mapped.skipRiskIncreasing
                ? [
                    "agent_skip_all_strategies",
                    "llm_path_mandatory",
                    ...(agentProposal?.declineReasons ?? []).slice(0, 3),
                  ]
                : [
                    "agent_not_authorized",
                    mapped.preferredStrategy
                      ? `agent_prefers_${mapped.preferredStrategy}`
                      : "agent_no_preferred_strategy",
                    "llm_path_mandatory",
                  ],
            });
            await syncAlertCausalMetadata(match.signal, {
              ...(match.signal?.policy_verdict
                ? { policyVerdict: match.signal.policy_verdict }
                : {}),
              actionStatus: mapped.skipRiskIncreasing ? "deferred" : "ignored",
            });
            continue;
          }

          const features = (
            match.signal
              ? featuresFromSignal(match.signal)
              : {
                  aaveSupplyApyBps: 0,
                  idleUsdcApyBps: 0,
                  consecutiveEdgePolls: 0,
                  totalCollateralUsd: inventory.totalCollateralUsd,
                  totalDebtUsd: inventory.totalDebtUsd,
                }
          ) as import("./types.ts").DeskSignalFeatures;
          const gasRegime = gasRegimeFromFeatures(features, (gwei) => {
            if (gwei == null || !Number.isFinite(gwei)) return "normal";
            if (gwei >= deps.config.gasElevatedGwei * 2) return "critical";
            if (gwei >= deps.config.gasElevatedGwei) return "elevated";
            return "normal";
          });

          let evalResult: StrategyEvaluateResult;
          try {
            evalResult = await deps.strategyRunner.evaluateAndPropose({
              strategy,
              features,
              inventory,
              gasRegime,
              killSwitchArmed: killArmed,
              openByStrategy,
              hasAnyOpenIntent,
              lastFailedAtMsByStrategy,
              lastMaintenanceAtMs,
              signalId: match.signal?.id ?? null,
              agentProposal,
              agentNotionalCapUsdc: mapped.notionalCapUsdc > 0 ? mapped.notionalCapUsdc : undefined,
            });
          } catch (error) {
            evaluations.push({
              signalId: match.signal?.id ?? null,
              signalType: match.signal?.signal_type ?? strategy,
              strategy,
              planAction: "error",
              reasonCodes: [error instanceof Error ? error.message : "evaluate_failed"],
            });
            await syncAlertCausalMetadata(match.signal, {
              ...(match.signal?.policy_verdict
                ? { policyVerdict: match.signal.policy_verdict }
                : {}),
              actionStatus: "failed",
            });
            continue;
          }

          const plannedActionStatus: AlertActionStatus = evalResult.intent
            ? "pending"
            : evalResult.plan.action === "ignore"
              ? "ignored"
              : "deferred";
          await syncAlertCausalMetadata(match.signal, {
            ...(match.signal?.policy_verdict ? { policyVerdict: match.signal.policy_verdict } : {}),
            actionStatus: plannedActionStatus,
            ...(evalResult.intent ? { intentId: evalResult.intent.id } : {}),
          });

          evaluations.push({
            signalId: match.signal?.id ?? null,
            signalType:
              match.signal?.signal_type ?? (match.synthetic ? "maintenance_inventory" : strategy),
            strategy,
            planAction: evalResult.plan.action,
            policyAllow: evalResult.policy?.allow,
            intentId: evalResult.intent?.id,
            reasonCodes: [
              ...evalResult.plan.reasonCodes,
              ...(evalResult.policy?.reasonCodes ?? []),
              ...(match.synthetic ? ["synthetic_maintenance_candidate"] : []),
            ],
          });

          if (evalResult.intent) {
            openByStrategy[strategy] = true;
            if (agentRunId) {
              await linkAgentRunToIntent(agentRunId, evalResult.intent.id);
            }
            if (execute && deskAddress) {
              const execResult = await deps.strategyRunner.executeIntent({
                intentId: evalResult.intent.id,
                deskAddress,
                inventory,
                publishTicket: true,
                signalType: match.signal?.signal_type ?? "maintenance_inventory",
                signalFeatures: features,
                // Only rotate-in sizing consumes the live balance; skip the
                // extra RPC for every other strategy execution.
                liveUsdcBalance:
                  evalResult.intent.strategy === "yield_rotation"
                    ? await liveDeskUsdcBalance()
                    : undefined,
              });
              executions.push(execResult);
              const executionActionStatus: AlertActionStatus =
                execResult.intent.status === "filled"
                  ? "filled"
                  : execResult.intent.status === "failed"
                    ? "failed"
                    : "submitted";
              await syncAlertCausalMetadata(match.signal, {
                ...(match.signal?.policy_verdict
                  ? { policyVerdict: match.signal.policy_verdict }
                  : {}),
                actionStatus: executionActionStatus,
                intentId: evalResult.intent.id,
                ...(execResult.ticket?.ticket.id ? { ticketId: execResult.ticket.ticket.id } : {}),
                ...(execResult.receipt?.txHash
                  ? { actionTransactionHash: execResult.receipt.txHash }
                  : {}),
                ...(execResult.receipt?.keeperHubRunId || execResult.ticket?.keeperHubRunId
                  ? {
                      actionKeeperHubRunId:
                        execResult.receipt?.keeperHubRunId ?? execResult.ticket?.keeperHubRunId,
                    }
                  : {}),
                ...(execResult.receipt?.explorerUrl || execResult.ticket?.explorerUrl
                  ? {
                      actionExplorerUrl:
                        execResult.receipt?.explorerUrl ?? execResult.ticket?.explorerUrl,
                    }
                  : {}),
              });
              if (execResult.intent.status === "filled") {
                await touchLastMaintenanceAt(
                  execResult.intent.reason_codes ?? evalResult.plan.reasonCodes,
                );
              }

              if (execResult.intent.status === "failed" && deps.failureClassifier) {
                try {
                  const classification = await deps.failureClassifier.classify({
                    strategy,
                    errorMessage: execResult.errorMessage ?? execResult.intent.error_message,
                    notionalUsdc: execResult.intent.notional_usdc,
                    healthFactor: mark.aave.healthFactor,
                    killSwitchArmed: killArmed,
                    reasonCodes: execResult.intent.reason_codes ?? [],
                  });
                  deskLog.info("failure_class", {
                    next: classification.nextStep,
                    confidence: classification.confidence,
                    reason: classification.reason,
                  });
                } catch {
                  // non-fatal
                }
              }
            }
          }

          // One agent-authorized strategy intent per tick
          if (evalResult.intent) {
            break;
          }
        }
      }

      // ── Phase 5: event-linked microtrade (newspaper → desk) ──────────
      // Only when enabled, no intent already this tick, kill/pause off.
      // Prefer tiny maintenance rebalance; oracle_amm only if basis valid.
      let eventMicrotrade: DeskTickResult["eventMicrotrade"];
      if (mark && !deps.getDeskPaused() && !deps.config.paused) {
        const tickHasIntent = evaluations.some((e) => e.intentId) || executions.length > 0;
        const nowMs = Date.now();
        const cfg = deps.config;
        const lookbackMs = cfg.eventMicrotradeLookbackMs;
        const triggers = cfg.eventMicrotradeEnabled
          ? await loadEventMicrotradeTriggers(lookbackMs, nowMs)
          : [];
        const lastMicroAt = await loadLastEventMicrotradeAtMs();
        const inventory = inventoryFromMark(mark);
        const hasAnyOpenIntent = await deps.intents.hasAnyOpen();
        const killArmed = deps.killSwitch.isArmed();

        // Optional gas regime from recent desk signals for fallback trigger
        let gasRegime: GasRegime | undefined;
        let oracleFeatures: import("./types.ts").DeskSignalFeatures | undefined;
        try {
          const recent = await deps.signals.listRecent(10);
          if (recent.ok) {
            for (const sig of recent.value) {
              const f = featuresFromSignal(sig);
              if (!gasRegime && f.gasRegime) {
                gasRegime = f.gasRegime as GasRegime;
              }
              if (
                !oracleFeatures &&
                sig.signal_type === "oracle_basis" &&
                f.oraclePrice != null &&
                f.ammPrice != null
              ) {
                oracleFeatures = f;
              }
            }
          }
        } catch {
          // non-fatal
        }

        const { eligibility, planResult } = evaluateAndPlanEventMicrotrade({
          eligibility: {
            enabled: cfg.eventMicrotradeEnabled,
            deskPaused: deps.getDeskPaused() || cfg.paused,
            killSwitchArmed: killArmed,
            hasAnyOpenIntent,
            tickAlreadyHasIntent: tickHasIntent,
            lastEventMicrotradeAtMs: lastMicroAt,
            cooldownMs: cfg.eventMicrotradeCooldownMs,
            lookbackMs,
            notionalCapUsdc: cfg.eventMicrotradeUsdc,
            maxTradeUsdc: cfg.maxTradeUsdc,
            freeUsdc: inventory.freeUsdc,
            triggers,
            gasRegime,
            nowMs,
          },
          inventory: {
            freeUsdc: inventory.freeUsdc,
            freeWeth: inventory.freeWeth,
            freeLink: inventory.freeLink,
            aaveLinkSupplied: inventory.aaveLinkSupplied,
            totalCollateralUsd: inventory.totalCollateralUsd,
            totalDebtUsd: inventory.totalDebtUsd,
            linkUsdPrice: inventory.linkUsdPrice,
            ethUsdPrice: inventory.ethUsdPrice,
            deskEquityUsdc: inventory.deskEquityUsdc,
          },
          config: cfg,
          features: oracleFeatures,
        });

        eventMicrotrade = {
          attempted: cfg.eventMicrotradeEnabled,
          allowed: eligibility.allow,
          skipReason: eligibility.skipReason,
          mode: planResult?.mode,
          monitoredEventId: eligibility.trigger?.monitoredEventId ?? null,
          reasonCodes: eligibility.reasonCodes,
        };

        if (
          eligibility.allow &&
          planResult &&
          planResult.plan.action === "propose" &&
          planResult.strategy
        ) {
          const strategy = planResult.strategy;
          const microFeatures: import("./types.ts").DeskSignalFeatures = oracleFeatures ?? {
            totalCollateralUsd: inventory.totalCollateralUsd,
            totalDebtUsd: inventory.totalDebtUsd,
          };

          await softAppendExecutionLog(deps.execLogRepo, {
            action_type: "desk_event_microtrade",
            entity_type: eligibility.trigger?.monitoredEventId ? "monitored_event" : "desk",
            entity_id: eligibility.trigger?.monitoredEventId ?? heartbeat.id,
            status: "started",
            message: `Event microtrade started (${planResult.mode}, trigger=${eligibility.trigger?.eventType ?? "unknown"})`,
            started_at: new Date().toISOString(),
            details: {
              phase: "event_microtrade",
              mode: planResult.mode,
              strategy,
              trigger: eligibility.trigger?.eventType ?? null,
              monitored_event_id: eligibility.trigger?.monitoredEventId ?? null,
              notional_usdc: planResult.plan.notionalUsdc,
              reason_codes: planResult.plan.reasonCodes,
            },
          });

          let evalResult: StrategyEvaluateResult;
          try {
            evalResult = await deps.strategyRunner.evaluateAndPropose({
              strategy,
              features: microFeatures,
              inventory,
              gasRegime: gasRegime ?? "normal",
              killSwitchArmed: killArmed,
              openByStrategy: await buildOpenByStrategy(),
              hasAnyOpenIntent,
              lastFailedAtMsByStrategy: await lastFailedAtByStrategy(),
              lastMaintenanceAtMs: await loadLastMaintenanceAtMs(),
              signalId: null,
              planOverride: planResult.plan,
              agentNotionalCapUsdc: planResult.plan.notionalUsdc,
            });
          } catch (error) {
            const msg = error instanceof Error ? error.message : "event_microtrade_eval_failed";
            evaluations.push({
              signalId: null,
              signalType: "event_linked_microtrade",
              strategy,
              planAction: "error",
              reasonCodes: [msg, ...planResult.plan.reasonCodes],
            });
            eventMicrotrade = {
              ...eventMicrotrade,
              allowed: false,
              skipReason: "no_executable_plan",
              reasonCodes: [...eventMicrotrade.reasonCodes, msg],
            };
            await softAppendExecutionLog(deps.execLogRepo, {
              action_type: "desk_event_microtrade",
              entity_type: "desk",
              entity_id: heartbeat.id,
              status: "failed",
              message: `Event microtrade eval failed: ${msg}`,
              completed_at: new Date().toISOString(),
              details: { phase: "event_microtrade", error: msg },
            });
            evalResult = { plan: { action: "ignore", reasonCodes: [msg] } };
          }

          if (evalResult.plan.action === "propose" || evalResult.intent) {
            evaluations.push({
              signalId: null,
              signalType: "event_linked_microtrade",
              strategy,
              planAction: evalResult.plan.action,
              policyAllow: evalResult.policy?.allow,
              intentId: evalResult.intent?.id,
              reasonCodes: [
                ...evalResult.plan.reasonCodes,
                ...(evalResult.policy?.reasonCodes ?? []),
              ],
            });
          } else if (evalResult.policy && !evalResult.policy.allow) {
            evaluations.push({
              signalId: null,
              signalType: "event_linked_microtrade",
              strategy,
              planAction: "policy_deny",
              policyAllow: false,
              reasonCodes: [...evalResult.plan.reasonCodes, ...evalResult.policy.reasonCodes],
            });
            await softAppendExecutionLog(deps.execLogRepo, {
              action_type: "desk_event_microtrade",
              entity_type: "desk",
              entity_id: heartbeat.id,
              status: "failed",
              message: "Event microtrade denied by policy",
              completed_at: new Date().toISOString(),
              details: {
                phase: "event_microtrade",
                reason_codes: evalResult.policy.reasonCodes,
              },
            });
          }

          if (evalResult.intent) {
            eventMicrotrade = {
              ...eventMicrotrade,
              intentId: evalResult.intent.id,
              reasonCodes: evalResult.intent.reason_codes ?? planResult.plan.reasonCodes,
            };
            if (agentRunId) {
              await linkAgentRunToIntent(agentRunId, evalResult.intent.id);
            }
            // Cooldown starts when an intent is created (not only on fill) so
            // failed KH executions do not spam retries within the window.
            await touchLastEventMicrotradeAt();

            // Attach or create a public Alert for the microtrade (reuse market Alert
            // when the monitored event already has one). Never blocks execution.
            let microtradeAlertId: string | null = null;
            if (deps.deskTriggerAlerts) {
              try {
                let existingAlertId: string | null = null;
                const monitoredEventId = eligibility.trigger?.monitoredEventId ?? null;
                if (monitoredEventId && deps.alertRepo?.listByEventIds) {
                  const alerts = await deps.alertRepo.listByEventIds([monitoredEventId]);
                  if (alerts.ok && alerts.value[0]) {
                    existingAlertId = alerts.value[0].id;
                  }
                }
                const alertResult = await deps.deskTriggerAlerts.createOrAttachForMicrotrade({
                  existingAlertId,
                  monitoredEventId,
                  eventType: eligibility.trigger?.eventType ?? null,
                  transactionHash: eligibility.trigger?.transactionHash ?? null,
                  sourceChainId: eligibility.trigger?.sourceChainId ?? null,
                  notionalUsdc: planResult.plan.notionalUsdc,
                  strategy,
                  mode: planResult.mode,
                  reasonCodes: evalResult.intent.reason_codes ?? planResult.plan.reasonCodes,
                });
                microtradeAlertId = alertResult?.alert.id ?? null;
                if (microtradeAlertId) {
                  await deps.deskTriggerAlerts.updateAfterExecution(microtradeAlertId, {
                    actionStatus: "pending",
                    policyVerdict: "trade",
                    intentId: evalResult.intent.id,
                  });
                }
              } catch (error) {
                deskLog.warn("microtrade desk-trigger alert failed (non-blocking)", {
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }

            if (execute && deskAddress) {
              const execResult = await deps.strategyRunner.executeIntent({
                intentId: evalResult.intent.id,
                deskAddress,
                inventory,
                publishTicket: true,
                signalType: "event_linked_microtrade",
                signalFeatures: {
                  ...microFeatures,
                  monitoredEventId: eligibility.trigger?.monitoredEventId ?? null,
                  eventType: eligibility.trigger?.eventType ?? null,
                },
                // Microtrades are USDC-spending but sized by the plan legs;
                // only rotation intents consume the live balance cap.
                liveUsdcBalance:
                  evalResult.intent.strategy === "yield_rotation"
                    ? await liveDeskUsdcBalance()
                    : undefined,
              });
              executions.push(execResult);
              if (microtradeAlertId) {
                const executionActionStatus: AlertActionStatus =
                  execResult.intent.status === "filled"
                    ? "filled"
                    : execResult.intent.status === "failed"
                      ? "failed"
                      : "submitted";
                await syncAlertCausalMetadata(
                  null,
                  {
                    policyVerdict: "trade",
                    actionStatus: executionActionStatus,
                    intentId: evalResult.intent.id,
                    ...(execResult.ticket?.ticket.id
                      ? { ticketId: execResult.ticket.ticket.id }
                      : {}),
                    ...(execResult.receipt?.txHash
                      ? { actionTransactionHash: execResult.receipt.txHash }
                      : {}),
                    ...(execResult.receipt?.keeperHubRunId || execResult.ticket?.keeperHubRunId
                      ? {
                          actionKeeperHubRunId:
                            execResult.receipt?.keeperHubRunId ??
                            execResult.ticket?.keeperHubRunId,
                        }
                      : {}),
                    ...(execResult.receipt?.explorerUrl || execResult.ticket?.explorerUrl
                      ? {
                          actionExplorerUrl:
                            execResult.receipt?.explorerUrl ?? execResult.ticket?.explorerUrl,
                        }
                      : {}),
                  },
                  microtradeAlertId,
                );
              }
              if (execResult.intent.status === "filled") {
                await touchLastMaintenanceAt(
                  execResult.intent.reason_codes ?? planResult.plan.reasonCodes,
                );
              }
              await softAppendExecutionLog(deps.execLogRepo, {
                action_type: "desk_event_microtrade",
                entity_type: "desk_intent",
                entity_id: evalResult.intent.id,
                status: execResult.intent.status === "filled" ? "succeeded" : "failed",
                message:
                  execResult.intent.status === "filled"
                    ? `Event microtrade filled (${planResult.mode})`
                    : `Event microtrade failed: ${execResult.errorMessage ?? execResult.intent.error_message ?? "unknown"}`,
                completed_at: new Date().toISOString(),
                details: {
                  phase: "event_microtrade",
                  mode: planResult.mode,
                  strategy,
                  monitored_event_id: eligibility.trigger?.monitoredEventId ?? null,
                  intent_id: evalResult.intent.id,
                  keeper_hub_run_id:
                    execResult.receipt?.keeperHubRunId ?? execResult.intent.keeper_hub_run_id,
                  tx_hash: execResult.receipt?.txHash ?? null,
                },
              });
            } else {
              await softAppendExecutionLog(deps.execLogRepo, {
                action_type: "desk_event_microtrade",
                entity_type: "desk_intent",
                entity_id: evalResult.intent.id,
                status: "succeeded",
                message: `Event microtrade intent proposed (execute=false, mode=${planResult.mode})`,
                completed_at: new Date().toISOString(),
                details: {
                  phase: "event_microtrade",
                  mode: planResult.mode,
                  intent_id: evalResult.intent.id,
                  monitored_event_id: eligibility.trigger?.monitoredEventId ?? null,
                },
              });
            }
          } else if (
            eligibility.allow &&
            planResult.plan.action === "propose" &&
            !evalResult.intent &&
            evalResult.plan.action !== "ignore"
          ) {
            // proposed plan but no intent (policy may have blocked earlier branch)
            await softAppendExecutionLog(deps.execLogRepo, {
              action_type: "desk_event_microtrade",
              entity_type: "desk",
              entity_id: heartbeat.id,
              status: "failed",
              message: "Event microtrade plan did not produce an intent",
              completed_at: new Date().toISOString(),
              details: {
                phase: "event_microtrade",
                plan_action: evalResult.plan.action,
                reason_codes: evalResult.plan.reasonCodes,
              },
            });
          }
        } else if (cfg.eventMicrotradeEnabled && eligibility.skipReason) {
          // Structured skip for observability when enabled but not firing
          if (
            eligibility.skipReason !== "disabled" &&
            eligibility.skipReason !== "tick_already_has_intent"
          ) {
            await softAppendExecutionLog(deps.execLogRepo, {
              action_type: "desk_event_microtrade",
              entity_type: "desk",
              entity_id: heartbeat.id,
              status: "succeeded",
              message: `Event microtrade skipped: ${eligibility.skipReason}`,
              completed_at: new Date().toISOString(),
              details: {
                phase: "event_microtrade",
                skip_reason: eligibility.skipReason,
                reason_codes: eligibility.reasonCodes,
              },
            });
          }
        }
      }

      let kill: KillSwitchTripResult | undefined;
      if (evaluateKill && deskAddress && treasuryAddress) {
        const freeUsdc = mark?.usdc ?? asNumber(body.freeUsdcOnDesk) ?? 0;
        const killReason = asString(body.killReason);
        kill = await deps.killSwitch.evaluate({
          freeUsdcOnDesk: freeUsdc,
          deskAddress,
          treasuryAddress,
          force: asBoolean(body.forceKill, false),
          ...(killReason !== undefined ? { reason: killReason } : {}),
        });
      }

      const filledCount = executions.filter((e) => e.intent.status === "filled").length;
      const failedCount = executions.filter((e) => e.intent.status === "failed").length;
      await softAppendExecLog({
        status: "succeeded",
        message: `Desk tick complete: agent=${agentProposal?.action ?? "none"} evals=${evaluations.length} execs=${executions.length}${
          agentRunId ? ` agentRun=${agentRunId}` : ""
        }${eventMicrotrade?.allowed ? ` eventMicrotrade=${eventMicrotrade.mode ?? "yes"}` : ""}`,
        entityType: "desk_tick",
        entityId: heartbeat.id,
        startedAt: tickStartedAt,
        details: {
          phase: "desk_tick",
          source: heartbeatSource,
          execute,
          evaluateKill,
          agentAction: agentProposal?.action ?? null,
          agentStrategy: agentProposal?.strategy ?? null,
          agentRunId: agentRunId ?? null,
          agentSkippedRisk,
          evaluationCount: evaluations.length,
          executionCount: executions.length,
          filledCount,
          failedCount,
          killTripped: kill?.tripped ?? false,
          markError: markError ?? null,
          freeUsdc: mark?.usdc ?? null,
          equityUsdc: mark?.equityUsdc ?? null,
          eventMicrotrade: eventMicrotrade ?? null,
        },
      });

      return {
        heartbeat,
        mark,
        markError: markError ?? undefined,
        evaluations,
        executions,
        kill,
        agentProposal,
        ...(agentRunId ? { agentRunId } : {}),
        ...(agentSkippedRisk ? { agentSkippedRisk: true } : {}),
        ...(eventMicrotrade ? { eventMicrotrade } : {}),
      };
    },

    async applyExecutionResult(body) {
      const intentId = asString(body.intentId);
      if (!intentId) {
        throw new Error("intentId is required");
      }

      const success = asBoolean(body.success, false);
      const keeperHubRunId = asString(body.keeperHubRunId);
      const errorMessage = asString(body.errorMessage);
      const fillsRaw = body.fills;
      const fills: DeskIntentFill[] = [];
      if (Array.isArray(fillsRaw)) {
        for (const item of fillsRaw) {
          if (!item || typeof item !== "object") continue;
          const f = item as Record<string, unknown>;
          const txHash = asString(f.txHash);
          if (!txHash) continue;
          fills.push({
            txHash,
            step: asNumber(f.step) ?? fills.length,
            ...f,
          });
        }
      }

      const existing = await deps.intents.findById(intentId);
      if (!existing) {
        throw new Error(`Desk intent not found: ${intentId}`);
      }

      if (!success) {
        const failed = await deps.intents.markFailed(
          intentId,
          errorMessage ?? "Execution reported failure",
          keeperHubRunId,
        );
        await syncAlertCausalMetadata(null, {
          actionStatus: "failed",
          intentId,
          ...(keeperHubRunId ? { actionKeeperHubRunId: keeperHubRunId } : {}),
        });
        return { intent: failed };
      }

      if (fills.length === 0) {
        throw new Error(
          "success=true requires at least one fill with a real txHash (no mock fills)",
        );
      }

      // Timeout reconciliation: executeIntent marks the intent failed when the
      // bridge's poll deadline expires, but the KeeperHub run may still finish
      // on-chain afterwards. A confirmed success with real fills is on-chain
      // truth — promote the timed-out intent instead of throwing an illegal
      // failed → filled transition.
      let filled: DeskIntentRow;
      if (existing.status === "failed") {
        // Run-id drift is expected on the public-fallback path (completion
        // arrives under `${idempotencyKey}-public-fallback`), so a mismatch is
        // not a stale callback — the signed success body with real fills is
        // authoritative. Log the drift and reconcile anyway.
        if (
          existing.keeper_hub_run_id &&
          keeperHubRunId &&
          existing.keeper_hub_run_id !== keeperHubRunId
        ) {
          deskLog.warn("reconciling timed-out intent with drifted run id", {
            intentId,
            failedRunId: existing.keeper_hub_run_id,
            completedRunId: keeperHubRunId,
          });
        }
        filled = await deps.intents.reconcileFilled(intentId, keeperHubRunId);
      } else {
        // Transition through executing if still proposed/approved
        if (existing.status === "proposed" || existing.status === "approved") {
          await deps.intents.markExecuting(intentId, keeperHubRunId);
        }
        filled = await deps.intents.markFilled(intentId, keeperHubRunId);
      }

      let ticket: TicketPublishResult | undefined;
      const publishTicket = asBoolean(body.publishTicket, true);
      if (publishTicket) {
        const policy =
          filled.policy_snapshot && typeof filled.policy_snapshot === "object"
            ? (filled.policy_snapshot as Record<string, unknown>)
            : {};
        const legs = (Array.isArray(filled.legs) ? filled.legs : []) as DeskLeg[];
        const hfAfter = asNumber(body.hfAfter);
        if (hfAfter !== undefined) {
          policy.hfAfter = hfAfter;
        }

        ticket = await deps.tickets.publish({
          intentId: filled.id,
          strategy: filled.strategy,
          signal: {
            type: asString(body.signalType) ?? filled.strategy,
            features:
              body.signalFeatures && typeof body.signalFeatures === "object"
                ? (body.signalFeatures as Record<string, unknown>)
                : {},
          },
          legs,
          fills,
          policy,
          notionalUsdc: filled.notional_usdc,
        });
      }

      // Best-effort Alert causal update via intent_id / ticket_id when no Signal exists.
      const primaryTx = fills[0]?.txHash;
      await syncAlertCausalMetadata(null, {
        policyVerdict: "trade",
        actionStatus: "filled",
        intentId: filled.id,
        ...(ticket?.ticket.id ? { ticketId: ticket.ticket.id } : {}),
        ...(primaryTx ? { actionTransactionHash: primaryTx } : {}),
        ...(keeperHubRunId ? { actionKeeperHubRunId: keeperHubRunId } : {}),
        ...(ticket?.explorerUrl ? { actionExplorerUrl: ticket.explorerUrl } : {}),
      });

      return { intent: filled, ticket };
    },

    async armKill(body = {}) {
      const reason = asString(body.reason) ?? "manual_api_kill";
      const trip = asBoolean(body.trip, false);
      const state = await deps.killSwitch.arm(reason);

      if (!trip) {
        return { state };
      }

      if (!deskAddress || !treasuryAddress) {
        return {
          state,
          trip: {
            tripped: false,
            state,
            errorMessage:
              "Cannot trip kill switch without DESK_WALLET_ADDRESS and treasury address",
          },
        };
      }

      const { mark } = await safeMark(true);
      const freeUsdc = asNumber(body.freeUsdcOnDesk) ?? mark?.usdc ?? 0;

      const tripResult = await deps.killSwitch.trip({
        reason,
        freeUsdcOnDesk: freeUsdc,
        deskAddress,
        treasuryAddress,
        withdrawLink: asBoolean(body.withdrawLink, false),
      });

      return { state: tripResult.state, trip: tripResult };
    },
  };
}

/** Narrow type re-export for execution input validation. */
export type { DeskExecutionResultInput };
