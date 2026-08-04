/**
 * Chronicle Desk domain types for the API signal → policy → intent → ticket path.
 * Aligned with packages/schemas desk enums and packages/db desk tables.
 */

import type {
  DeskCapitalDirection,
  DeskHeartbeatSource,
  DeskIntentStatus,
  DeskPolicyVerdict,
  DeskSignalType,
  DeskStrategy,
} from "@chronicleai/schemas";
import { DESK_CHAIN_ID } from "@chronicleai/schemas";

export { DESK_CHAIN_ID };

// ── Legs / plans ────────────────────────────────────────

/** One ordered protocol action inside a trade intent. */
export interface DeskLeg {
  protocol: string;
  action: string;
  asset?: string;
  amount?: string;
  tokenIn?: string;
  tokenOut?: string;
  amountIn?: string;
  amountOutMin?: string;
  /** Optional human-readable note for tickets / UI. */
  note?: string;
  [key: string]: unknown;
}

export type GasRegime = "normal" | "elevated" | "critical";

/** Policy snapshot frozen onto an intent at decision time. */
export interface DeskPolicySnapshot {
  maxTradeUsdc: number;
  minAumUsdc: number;
  targetAumUsdc: number;
  maxAumUsdc: number;
  hfWarn: number;
  hfCritical: number;
  basisBps: number;
  apyDeltaBps: number;
  deskPaused: boolean;
  killSwitchArmed: boolean;
  gasRegime: GasRegime;
  deskEquityUsdc: number;
  freeUsdc: number;
  notionalUsdc: number;
  simulatedHfAfter?: number;
  reasonCodes: string[];
  evaluatedAt: string;
  [key: string]: unknown;
}

// ── Signals ─────────────────────────────────────────────

export interface DeskSignalFeatures {
  hf?: number | undefined;
  basisBps?: number | undefined;
  apyDeltaBps?: number | undefined;
  gasGwei?: number | undefined;
  gasRegime?: GasRegime | undefined;
  aaveSupplyApyBps?: number | undefined;
  morphoApyBps?: number | undefined;
  idleUsdcApyBps?: number | undefined;
  oraclePrice?: number | undefined;
  ammPrice?: number | undefined;
  /** Decimal metadata from basis poll (WETH→USDC defaults 18/6). */
  ammTokenInDecimals?: number | undefined;
  ammTokenOutDecimals?: number | undefined;
  ammTokenIn?: string | undefined;
  ammTokenOut?: string | undefined;
  /** How ingest derived ETH/USD mid (geometric_mid / forward_quote / …). */
  ammQuoteMethod?: string | undefined;
  ammForwardPrice?: number | undefined;
  ammReversePrice?: number | undefined;
  /** True when recovered AMM mid is outside ETH_USD_PRICE_MIN/MAX. */
  ammPriceOutOfBand?: boolean | undefined;
  ammFee?: number | undefined;
  oracleUpdatedAtMs?: number | undefined;
  consecutiveEdgePolls?: number | undefined;
  totalCollateralUsd?: number | undefined;
  totalDebtUsd?: number | undefined;
  [key: string]: unknown;
}

export interface DeskSignalSources {
  contracts?: string[] | undefined;
  readResults?: Record<string, unknown> | undefined;
  txRefs?: string[] | undefined;
  workflowRunId?: string | undefined;
  pollKind?: string | undefined;
  [key: string]: unknown;
}

/** In-memory / ingest shape before or after persistence. */
export interface DeskSignalInput {
  signalType: DeskSignalType;
  chainId?: number | undefined;
  severity?: number | undefined;
  features: DeskSignalFeatures;
  sources?: DeskSignalSources | undefined;
  dedupeKey: string;
  createdAt?: string | undefined;
  sourceAlertId?: string | null | undefined;
  sourceEventId?: string | null | undefined;
  signalOrigin?: "alert" | "desk_read" | "manual" | undefined;
  sourceDedupeKey?: string | null | undefined;
  sourceEvidence?: Record<string, unknown> | undefined;
}

export interface DeskSignalRecord {
  id?: string | undefined;
  signalType: DeskSignalType;
  chainId: number;
  severity: number;
  features: DeskSignalFeatures;
  sources: DeskSignalSources;
  policyVerdict: DeskPolicyVerdict;
  dedupeKey: string;
  createdAt: string;
}

// ── Intents ─────────────────────────────────────────────

export interface DeskIntentDraft {
  signalId?: string | null | undefined;
  strategy: DeskStrategy;
  status?: DeskIntentStatus | undefined;
  notionalUsdc: number;
  legs: DeskLeg[];
  reasonCodes: string[];
  policySnapshot: DeskPolicySnapshot;
}

export interface DeskIntentFill {
  txHash: string;
  step: number;
  [key: string]: unknown;
}

export interface DeskExecutionResultInput {
  intentId: string;
  success: boolean;
  keeperHubRunId?: string;
  fills?: DeskIntentFill[];
  errorMessage?: string;
  /** Optional post-trade HF for ticket policy. */
  hfAfter?: number;
}

// ── Positions ───────────────────────────────────────────

export interface AaveAccountSnapshot {
  totalCollateralUsd: number;
  totalDebtUsd: number;
  availableBorrowsUsd: number;
  currentLiquidationThreshold: number;
  ltv: number;
  healthFactor: number | null;
  /**
   * Exact aEthLINK (aToken) balance in human LINK units when read from chain.
   * Prefer this over collateralUsd/price for withdraw sizing.
   */
  aLinkSupplied?: number | undefined;
  /** Raw Aave base units (8 decimals USD) when available. */
  raw?: {
    totalCollateralBase: string;
    totalDebtBase: string;
    healthFactorRay: string;
    aLinkSuppliedBase?: string;
  };
}

export interface DeskPositionMark {
  asOf: string;
  deskAddress: string;
  usdc: number;
  weth: number;
  link: number;
  aave: AaveAccountSnapshot;
  morpho?: Record<string, unknown> | null;
  lido?: Record<string, unknown> | null;
  /** Marked book equity in USDC (inventory + aave net). */
  equityUsdc: number;
  ethUsd?: number | null;
  linkUsd?: number | null;
  raw?: Record<string, unknown>;
}

// ── Capital ─────────────────────────────────────────────

export type CapitalAction =
  | "none"
  | "topup"
  | "sweep"
  | "emergency_return"
  /** On-desk unwind to restore free USDC (Aave withdraw+swap / free LINK swap). */
  | "free_inventory";

export interface CapitalDecision {
  action: CapitalAction;
  amountUsdc: number;
  reason: string;
  direction?: DeskCapitalDirection;
  /** Inventory source when action is free_inventory. */
  inventorySource?: "aave_link" | "free_link" | "mixed" | undefined;
}

export interface CapitalTickInput {
  /**
   * Ethereum Sepolia treasury USDC only — capital manager never spends Base USDC.
   */
  treasuryUsdc: number;
  treasurySafetyBufferEth: number;
  /** Authoritative ETH gas buffer in ETH units (informational for logs). */
  treasuryEthBalance?: number | undefined;
  usdcOperatingReserve: number;
  deskEquityUsdc: number;
  freeUsdcOnDesk: number;
  lastTopupAtMs?: number | null | undefined;
  deskPaused: boolean;
  killSwitchArmed: boolean;
  nowMs?: number | undefined;
  /**
   * Base Sepolia USDC (payment rail). Used only for starvation messaging /
   * awaiting-CCTP reason when Sepolia cannot fund a top-up.
   */
  treasuryBaseUsdc?: number | undefined;
  /** CCTP base safety buffer (USDC) for surplus calc. */
  cctpBaseSafetyBufferUsdc?: number | undefined;
  /** Min Base surplus above buffer before rebalance is considered "flush". */
  cctpRebalanceThresholdUsdc?: number | undefined;
  /** Target top-up chunk (defaults to policy chunk when omitted). */
  topupChunkUsdc?: number | undefined;
  /** Free LINK on desk (human units) for free-inventory unwind sizing. */
  freeLinkOnDesk?: number | undefined;
  /** LINK/USD mark for free-inventory sizing (null when unpriced). */
  linkUsdPrice?: number | null | undefined;
  /** Aave total collateral marked USD (freeable when debt ≈ 0). */
  aaveTotalCollateralUsd?: number | undefined;
  /** Aave total debt marked USD. */
  aaveTotalDebtUsd?: number | undefined;
  /** Optional Aave LINK supplied (human units) when known from inventory. */
  aaveLinkSupplied?: number | undefined;
  /**
   * Timestamp (ms) of last filled free-powder maintenance intent
   * (`free_usdc_shortfall`). Used for post-maintenance sweep cooldown.
   */
  lastFreePowderFillAtMs?: number | null | undefined;
  /**
   * When true, pause max-AUM sweeps (powder thrash guard). Profit excess
   * free above powder + profit threshold may still sweep.
   */
  suppressMaxAumSweep?: boolean | undefined;
}

// ── Tickets ─────────────────────────────────────────────

export interface DeskTicketBuildInput {
  intentId: string;
  strategy: DeskStrategy;
  signal: { type: string; features: Record<string, unknown> };
  legs: DeskLeg[];
  fills: DeskIntentFill[];
  policy: Record<string, unknown>;
  notionalUsdc: number;
  createdAt?: string | undefined;
  summary?: string | undefined;
  /**
   * Execution audit spine (preflight → submit → outcome).
   * Stored as a **sibling** of the hashed canonical ticket body so
   * ticketHash semantics stay stable (plan §8.4).
   */
  executionAudit?: import("./execution-audit.ts").DeskExecutionAuditV1 | null | undefined;
}

// ── Policy engine I/O ───────────────────────────────────

export interface DeskPolicyConfig {
  targetAumUsdc: number;
  maxAumUsdc: number;
  minAumUsdc: number;
  topupChunkUsdc: number;
  /** Floor of liquid free USDC on desk. */
  minFreeUsdc: number;
  /** Chunk to free/top-up when free USDC is below minFreeUsdc. */
  inventoryTopupUsdc: number;
  /** Prefer on-desk unwind over treasury top-up for free-USDC shortfall. */
  preferUnwindForFreeUsdc: boolean;
  profitSweepUsdc: number;
  topupCooldownMs: number;
  /**
   * After a free-powder maintenance fill, skip max-AUM sweeps for this long
   * unless free USDC is well above minFree + profitSweep.
   */
  postMaintenanceSweepCooldownMs: number;
  hfWarn: number;
  hfCritical: number;
  basisBps: number;
  apyDeltaBps: number;
  maxTradeUsdc: number;
  killHeartbeatMs: number;
  failedRunCooldownMs: number;
  oracleMaxStalenessMs: number;
  apyConsecutivePolls: number;
  /**
   * APY edge (bps) above which rates are treated as unreliable (testnet absurd).
   * Edge-based rotation is suppressed; maintenance free-powder may still run.
   */
  apyAbsurdBps: number;
  /** When true, trust configured Sepolia edges above the data-quality ceiling. */
  trustTestnetSignals?: boolean;
  /** Min ms between maintenance rebalance fills. */
  rebalanceIntervalMs: number;
  /** Notional cap for maintenance free-powder legs (USDC). */
  maintenanceNotionalUsdc: number;
  gasElevatedGwei: number;
  /**
   * When true, qualified newspaper events may authorize a policy-capped
   * event-linked microtrade on desk ticks (enabled by default).
   */
  eventMicrotradeEnabled: boolean;
  /** Per-event microtrade notional cap (USDC); also ≤ maxTradeUsdc. */
  eventMicrotradeUsdc: number;
  /** Min ms between event-linked microtrade attempts. */
  eventMicrotradeCooldownMs: number;
  /** Lookback window (ms) for qualifying monitored events. */
  eventMicrotradeLookbackMs: number;
  paused: boolean;
}

export interface PolicyEvaluationContext {
  strategy: DeskStrategy;
  /** Whether the proposed action increases risk (borrow / open arb). Defend is not. */
  riskIncreasing: boolean;
  proposedNotionalUsdc: number;
  deskEquityUsdc: number;
  freeUsdc: number;
  /** Open intents keyed by strategy (single-flight). */
  openByStrategy: Partial<Record<DeskStrategy, boolean>>;
  /** When true, no strategy may open a new intent (global single-flight). */
  globalSingleFlight?: boolean | undefined;
  hasAnyOpenIntent?: boolean | undefined;
  gasRegime: GasRegime;
  killSwitchArmed: boolean;
  lastFailedAtMsByStrategy?: Partial<Record<DeskStrategy, number>> | undefined;
  simulatedHfAfter?: number | undefined;
  oracleUpdatedAtMs?: number | undefined;
  nowMs?: number | undefined;
}

export interface PolicyDecision {
  allow: boolean;
  verdict: DeskPolicyVerdict;
  reasonCodes: string[];
  sizedNotionalUsdc: number;
  policySnapshot: DeskPolicySnapshot;
}

export type StrategyPlan =
  | { action: "ignore"; reasonCodes: string[] }
  | {
      action: "propose";
      strategy: DeskStrategy;
      notionalUsdc: number;
      legs: DeskLeg[];
      reasonCodes: string[];
      riskIncreasing: boolean;
      simulatedHfAfter?: number | undefined;
      severity: number;
      policyVerdict: DeskPolicyVerdict;
    };

export interface HeartbeatStatus {
  lastSeenAt: string | null;
  ageMs: number | null;
  stale: boolean;
  killEligible: boolean;
  source: DeskHeartbeatSource | null;
}

/** Map ServerEnv desk knobs → policy config. */
export function deskPolicyConfigFromEnv(env: {
  deskTargetAumUsdc: number;
  deskMaxAumUsdc: number;
  deskMinAumUsdc: number;
  deskTopupChunkUsdc: number;
  deskMinFreeUsdc: number;
  deskInventoryTopupUsdc: number;
  deskPreferUnwindForFreeUsdc: boolean;
  deskProfitSweepUsdc: number;
  deskTopupCooldownMs: number;
  deskPostMaintenanceSweepCooldownMs: number;
  deskHfWarn: number;
  deskHfCritical: number;
  deskBasisBps: number;
  deskApyDeltaBps: number;
  deskMaxTradeUsdc: number;
  deskKillHeartbeatMs: number;
  deskFailedRunCooldownMs: number;
  deskOracleMaxStalenessMs: number;
  deskApyConsecutivePolls: number;
  deskApyAbsurdBps: number;
  deskTrustTestnetSignals?: boolean;
  deskRebalanceIntervalMs: number;
  deskMaintenanceNotionalUsdc: number;
  deskGasElevatedGwei: number;
  deskEventMicrotradeEnabled: boolean;
  deskEventMicrotradeUsdc: number;
  deskEventMicrotradeCooldownMs: number;
  deskEventMicrotradeLookbackMs: number;
  deskPaused: boolean;
}): DeskPolicyConfig {
  return {
    targetAumUsdc: env.deskTargetAumUsdc,
    maxAumUsdc: env.deskMaxAumUsdc,
    minAumUsdc: env.deskMinAumUsdc,
    topupChunkUsdc: env.deskTopupChunkUsdc,
    minFreeUsdc: env.deskMinFreeUsdc,
    inventoryTopupUsdc: env.deskInventoryTopupUsdc,
    preferUnwindForFreeUsdc: env.deskPreferUnwindForFreeUsdc,
    profitSweepUsdc: env.deskProfitSweepUsdc,
    topupCooldownMs: env.deskTopupCooldownMs,
    postMaintenanceSweepCooldownMs: env.deskPostMaintenanceSweepCooldownMs,
    hfWarn: env.deskHfWarn,
    hfCritical: env.deskHfCritical,
    basisBps: env.deskBasisBps,
    apyDeltaBps: env.deskApyDeltaBps,
    maxTradeUsdc: env.deskMaxTradeUsdc,
    killHeartbeatMs: env.deskKillHeartbeatMs,
    failedRunCooldownMs: env.deskFailedRunCooldownMs,
    oracleMaxStalenessMs: env.deskOracleMaxStalenessMs,
    apyConsecutivePolls: env.deskApyConsecutivePolls,
    apyAbsurdBps: env.deskApyAbsurdBps,
    trustTestnetSignals: env.deskTrustTestnetSignals === true,
    rebalanceIntervalMs: env.deskRebalanceIntervalMs,
    maintenanceNotionalUsdc: env.deskMaintenanceNotionalUsdc,
    gasElevatedGwei: env.deskGasElevatedGwei,
    eventMicrotradeEnabled: env.deskEventMicrotradeEnabled,
    eventMicrotradeUsdc: env.deskEventMicrotradeUsdc,
    eventMicrotradeCooldownMs: env.deskEventMicrotradeCooldownMs,
    eventMicrotradeLookbackMs: env.deskEventMicrotradeLookbackMs,
    paused: env.deskPaused,
  };
}
