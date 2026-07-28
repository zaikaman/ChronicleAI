// Public desk API response shapes (GET /desk/*)

export interface DeskKillSwitchState {
  armed: boolean;
  armedAt: string | null;
  armedReason: string | null;
  lastTripAt: string | null;
  lastTripReason: string | null;
  lastKeeperHubRunId: string | null;
  lastTxHash: string | null;
}

export interface DeskHeartbeatStatus {
  lastSeenAt: string | null;
  ageMs: number | null;
  stale: boolean;
  killEligible: boolean;
  source: string | null;
}

export interface DeskAgentSummary {
  action: string;
  strategy: string | null;
  notionalUsdc: number;
  confidence: number;
  thesis: string;
  priority: number;
  declineReasons: string[];
  riskNotes: string[];
  forceDefendOverride: boolean;
  forceMaintenanceOverride?: boolean;
  model: string | null;
  latencyMs: number | null;
  createdAt: string | null;
  intentId: string | null;
  errorMessage: string | null;
}

export interface DeskPrivateRoutingStatus {
  enabled: boolean;
  strict: boolean;
  provider: string;
  chainId: number;
  label: string;
}

export interface DeskStatus {
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
  killSwitch: DeskKillSwitchState;
  heartbeat: DeskHeartbeatStatus;
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
  /** Private routing policy surface (Phase 2). */
  privateRouting?: DeskPrivateRoutingStatus | null;
  lastAgent?: DeskAgentSummary | null;
  /** True when mandatory LLM path is live (enabled + LLM key). */
  agentEnabled?: boolean;
  /** Fail-closed reason when agentEnabled is false. */
  agentBlockedReason?: string | null;
}

export interface DeskIntentSummary {
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
  agentThesis?: string | null;
  agentConfidence?: number | null;
  agentAction?: string | null;
}

export interface DeskTicketLegSummary {
  protocol: string;
  action: string;
  asset?: string | null;
  tokenIn?: string | null;
  tokenOut?: string | null;
}

export interface DeskTicketNarrative {
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
  strategy: string | null;
  notionalUsdc: number | null;
  signalType: string | null;
  legs: DeskTicketLegSummary[];
  reasonCodes: string[];
  fillsCount: number;
  fillTxHashes: string[];
  agentThesis?: string | null;
  agentConfidence?: number | null;
  agentAction?: string | null;
  /** private_mempool | public when stored at fill time. */
  routing?: string | null;
  routingStrict?: boolean | null;
  routingProvider?: string | null;
  /** Calm product copy for execution path. */
  executionPath?: string | null;
  /** Flashbots Protect status URL when private routing was requested (Sepolia). */
  protectStatusUrl?: string | null;
  protectStatusUrls?: Array<{ txHash: string; url: string }> | null;
}

export interface DeskTicketProofs {
  ticketHash: string | null;
  signalHash: string | null;
  intentHash: string | null;
  txHash: string | null;
  explorerUrl: string | null;
  keeperHubRunId: string | null;
  contentUri: string | null;
  fillTxHashes?: string[];
}

export interface DeskCapitalMove {
  id: string;
  direction: string;
  amountUsdc: number;
  fromAddress: string;
  toAddress: string;
  /** Transfer / workflow funding tx. */
  txHash: string | null;
  explorerUrl: string | null;
  /** recordCapitalMove registry audit (linked dual-tx trail). */
  registryTxHash?: string | null;
  registryExplorerUrl?: string | null;
  keeperHubRunId?: string | null;
  reason: string | null;
  treasuryUsdcAfter: number | null;
  deskEquityAfter: number | null;
  createdAt: string;
}

/** v1 strategies — read-only on public desk UI. */
export const DESK_STRATEGY_META: Array<{
  id: string;
  label: string;
  description: string;
}> = [
  {
    id: "risk_defend",
    label: "Risk defend",
    description: "Aave health-factor defend and delever when HF drops under policy.",
  },
  {
    id: "yield_rotation",
    label: "Yield rotation",
    description: "Rotate USDC book into higher APY venues when edge clears the bar.",
  },
  {
    id: "oracle_amm",
    label: "Oracle–AMM",
    description: "Capped Uniswap fade when oracle vs AMM basis exceeds the band.",
  },
];
