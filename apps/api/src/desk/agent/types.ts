/**
 * Desk LLM trading agent types (server-side).
 * Canonical proposal lives in @chronicleai/schemas.
 */

import type {
  DeskAgentProposal,
  DeskFailureRecoveryAction,
  DeskSignalFusionLabel,
  DeskStrategy,
} from "@chronicleai/schemas";
import type { GasRegime } from "../types.ts";

export type {
  DeskAgentAction,
  DeskAgentLegsHint,
  DeskAgentProposal,
  DeskFailureRecoveryAction,
  DeskSignalFusionLabel,
} from "@chronicleai/schemas";

/** Public policy knobs exposed to the agent (no secrets). */
export interface DeskAgentPolicySnapshot {
  maxTradeUsdc: number;
  minAumUsdc: number;
  targetAumUsdc: number;
  maxAumUsdc: number;
  hfWarn: number;
  hfCritical: number;
  basisBps: number;
  apyDeltaBps: number;
  apyConsecutivePolls?: number | undefined;
  oracleMaxStalenessMs?: number | undefined;
  /** Floor of liquid free USDC (maintenance free-powder trigger). */
  minFreeUsdc?: number | undefined;
  /** Cap for maintenance free-powder notional. */
  maintenanceNotionalUsdc?: number | undefined;
  paused: boolean;
  killSwitchArmed: boolean;
  gasRegime: GasRegime;
  forceDefendOnCriticalHf: boolean;
  minConfidence: number;
  /** Explicit opt-in to treat large Sepolia edges as executable candidates. */
  trustTestnetSignals?: boolean | undefined;
}

/** Compact inventory / mark for agent context. */
export interface DeskAgentMarkSnapshot {
  asOf: string | null;
  equityUsdc: number | null;
  freeUsdc: number | null;
  freeWeth: number | null;
  freeLink: number | null;
  healthFactor: number | null;
  totalCollateralUsd: number | null;
  totalDebtUsd: number | null;
  ethUsd: number | null;
  linkUsd: number | null;
  /** Estimated freeable Aave LINK (human units) when known from mark. */
  aaveLinkSupplied?: number | null | undefined;
}

export interface DeskAgentSignalSnapshot {
  id: string;
  signalType: string;
  severity: number;
  policyVerdict: string;
  features: Record<string, unknown>;
  createdAt: string;
  /** Soft fusion label when present (Role D). */
  fusionLabel?: DeskSignalFusionLabel | undefined;
}

export interface DeskAgentIntentSnapshot {
  id: string;
  strategy: string;
  status: string;
  notionalUsdc: number;
  reasonCodes: string[];
  errorMessage: string | null;
  createdAt: string;
}

export interface DeskAgentCapitalMoveSnapshot {
  id: string;
  direction: string;
  amountUsdc: number;
  reason: string | null;
  createdAt: string;
}

/**
 * Pre-fetched tool snapshot (Option A single-shot).
 * Same data the multi-round tools would return.
 */
export interface DeskAgentContext {
  chainId: number;
  deskWalletAddress: string | null;
  mark: DeskAgentMarkSnapshot;
  policy: DeskAgentPolicySnapshot;
  signals: DeskAgentSignalSnapshot[];
  intents: DeskAgentIntentSnapshot[];
  openByStrategy: Partial<Record<DeskStrategy, boolean>>;
  lastFailedByStrategy: Partial<Record<DeskStrategy, { id: string; errorMessage: string | null; at: string }>>;
  capitalMoves: DeskAgentCapitalMoveSnapshot[];
  lastCapitalSummary: string | null;
  gasRegime: GasRegime;
  gasGwei: number | null;
}

export interface DeskAgentRunResult {
  proposal: DeskAgentProposal;
  /** True when LLM HTTP failed / timed out / invalid JSON → safe hold. */
  safeDefault: boolean;
  errorMessage?: string | undefined;
  rawResponse?: string | undefined;
  provider?: string | undefined;
  latencyMs: number;
}

export interface DeskFailureClassification {
  version: 1;
  nextStep: DeskFailureRecoveryAction;
  confidence: number;
  reason: string;
  model?: string | undefined;
  latencyMs?: number | undefined;
}

export interface DeskSignalFusionResult {
  version: 1;
  label: DeskSignalFusionLabel;
  confidence: number;
  reason: string;
  model?: string | undefined;
  latencyMs?: number | undefined;
}

/** Public summary for GET /desk/agent/latest and status badge. */
export interface PublicDeskAgentSummary {
  action: string;
  strategy: string | null;
  notionalUsdc: number;
  confidence: number;
  thesis: string;
  priority: number;
  declineReasons: string[];
  riskNotes: string[];
  forceDefendOverride: boolean;
  forceMaintenanceOverride: boolean;
  model: string | null;
  latencyMs: number | null;
  createdAt: string | null;
  intentId: string | null;
  errorMessage: string | null;
}
