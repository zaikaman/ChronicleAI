/**
 * CCTP rebalance domain types (policy + service orchestration).
 */

import type { CctpRebalanceTransferRow } from "@chronicleai/db";
import type {
  CctpRebalanceMode,
  CctpRebalanceStatus,
} from "@chronicleai/schemas";

export type {
  CctpRebalanceMode,
  CctpRebalanceStatus,
  CctpRebalanceTransferRow,
};

/** Dual-rail balances the policy must evaluate. */
export interface CctpTreasuryBalances {
  treasuryBaseUsdc: number;
  treasurySepoliaUsdc: number;
  treasuryBaseEth: number;
  treasurySepoliaEth: number;
  /** Sum of amount_usdc on non-terminal in-flight rows (policy accounting). */
  inFlightUsdc: number;
}

export interface CctpPolicyConfig {
  enabled: boolean;
  baseSafetyBufferUsdc: number;
  rebalanceThresholdUsdc: number;
  rebalanceChunkUsdc: number;
  rebalanceMaxChunkUsdc: number;
  maxInFlight: number;
  cooldownMs: number;
  maxFeeUsdc: number;
  baseMinGasEth: number;
  sepoliaMinGasEth: number;
  /**
   * When true, Mode A gas gate is enforced. When false (forwarding-only path),
   * Sepolia gas is not required to start a burn.
   */
  requireSepoliaGasForDirectMint: boolean;
  /** Kill-switch / emergency pause blocks new burns. */
  emergencyPaused: boolean;
  /**
   * When true and desk is starved, cooldown may be skipped (demo).
   * Default false per plan.
   */
  forceOnDeskStarvation: boolean;
}

export interface CctpPolicyInput {
  balances: CctpTreasuryBalances;
  inFlightCount: number;
  /** ISO timestamp of last successful burn, or null. */
  lastSuccessfulBurnAt: string | null;
  nowMs?: number | undefined;
  /** Preferred mode for gas gating (direct requires Sepolia gas). */
  mode?: CctpRebalanceMode | undefined;
  /**
   * Optional desk-starvation signal for force-on-starvation path.
   * Only used when config.forceOnDeskStarvation is true.
   */
  deskStarved?: boolean | undefined;
  /** Optional amount override (still capped by policy max + available). */
  amountOverrideUsdc?: number | undefined;
}

export type CctpPolicySkipReason =
  | "disabled"
  | "emergency_paused"
  | "max_in_flight"
  | "cooldown"
  | "below_threshold"
  | "insufficient_base_gas"
  | "insufficient_sepolia_gas"
  | "amount_zero"
  | "invalid_balances";

export interface CctpPolicyDecision {
  eligible: boolean;
  amountUsdc: number;
  amountAtomic: string;
  maxFeeAtomic: string;
  reason: CctpPolicySkipReason | "eligible";
  /** Human-readable detail for logs / status. */
  detail: string;
  /** Available Base USDC above safety buffer before chunk cap. */
  availableAboveBufferUsdc: number;
}

export type CctpTickOutcome =
  | "skipped"
  | "started"
  | "burned"
  | "minted"
  | "stuck"
  | "failed"
  | "awaiting_attestation"
  | "error";

export interface CctpTickResult {
  outcome: CctpTickOutcome;
  reason?: string | undefined;
  transferId?: string | undefined;
  status?: CctpRebalanceStatus | undefined;
  burnTxHash?: string | undefined;
  mintTxHash?: string | undefined;
  amountUsdc?: number | undefined;
  mode?: CctpRebalanceMode | undefined;
  errorClass?: CctpErrorClass | undefined;
  errorMessage?: string | undefined;
}

export interface CctpResumeItemResult {
  transferId: string;
  outcome: CctpTickOutcome;
  status?: CctpRebalanceStatus | undefined;
  burnTxHash?: string | null | undefined;
  mintTxHash?: string | null | undefined;
  errorClass?: CctpErrorClass | undefined;
  errorMessage?: string | undefined;
}

export interface CctpResumeResult {
  processed: number;
  results: CctpResumeItemResult[];
}

export interface CctpStatusSnapshot {
  enabled: boolean;
  inFlightCount: number;
  inFlightUsdc: number;
  lastSuccessfulBurnAt: string | null;
  recent: CctpRebalanceTransferRow[];
  balances?: CctpTreasuryBalances | undefined;
  policy?: CctpPolicyDecision | undefined;
}

export type CctpErrorClass =
  | "gas"
  | "allowance"
  | "iris_429"
  | "iris_5xx"
  | "iris_timeout"
  | "iris_parse"
  | "revert"
  | "nonce_used"
  | "network"
  | "validation"
  | "unknown";

export interface IrisMessage {
  status?: string | null;
  message?: string | null;
  attestation?: string | null;
  /** Circle may return camelCase or snake_case depending on API version. */
  messageHash?: string | null;
  eventNonce?: string | null;
  forwardTxHash?: string | null;
  txHash?: string | null;
  sourceDomain?: number | null;
  destinationDomain?: number | null;
  decodedMessage?: unknown;
  raw: Record<string, unknown>;
}

export interface IrisMessagesResponse {
  messages: IrisMessage[];
  raw: unknown;
}

export interface IrisFeeQuote {
  minimumFee: number;
  finalityThreshold: number;
  raw: unknown;
}

export interface DepositForBurnParams {
  amountAtomic: bigint;
  destinationDomain: number;
  mintRecipient: string;
  burnToken: string;
  destinationCaller?: string;
  maxFeeAtomic: bigint;
  minFinalityThreshold: number;
  /** When set, encodes depositForBurnWithHook. */
  hookData?: string;
}

export interface CctpChainWriteResult {
  txHash: string;
  gasUsed?: string | undefined;
  explorerUrl?: string | undefined;
}

export interface CctpChainExecutor {
  /**
   * Signer address for approve/burn/mint. Production: Para treasury (same as
   * mint recipient). Legacy: operator EOA that holds Base USDC + gas.
   */
  getOperatorAddress(): Promise<string>;
  getUsdcBalance(chainId: number, holder: string): Promise<number>;
  getNativeBalanceEth(chainId: number, holder: string): Promise<number>;
  getUsdcAllowance(
    chainId: number,
    owner: string,
    spender: string,
  ): Promise<bigint>;
  approveUsdc(
    chainId: number,
    spender: string,
    amountAtomic: bigint,
  ): Promise<CctpChainWriteResult>;
  depositForBurn(
    chainId: number,
    params: DepositForBurnParams,
  ): Promise<CctpChainWriteResult>;
  receiveMessage(
    chainId: number,
    message: string,
    attestation: string,
  ): Promise<CctpChainWriteResult>;
  /**
   * Optional: verify a Sepolia mint Transfer to treasury (for forwarding mode).
   * Returns true when a matching Transfer is observed or when not implemented
   * (service may skip verification).
   */
  verifyMintTransfer?(
    chainId: number,
    mintTxHash: string,
    recipient: string,
    minAmountAtomic: bigint,
  ): Promise<boolean>;
}

export interface CctpServiceConfig {
  enabled: boolean;
  treasuryAddress: string;
  /** Always treasury for v1 — never operator. */
  mintRecipient: string;
  sourceDomain: number;
  destDomain: number;
  sourceChainId: number;
  destChainId: number;
  baseUsdcAddress: string;
  sepoliaUsdcAddress: string;
  tokenMessenger: string;
  messageTransmitter: string;
  /**
   * When true, may still accept Iris forwardTxHash if already present.
   * Does not delay mint: Iris complete → receiveMessage immediately.
   */
  useForwarding: boolean;
  minFinalityThreshold: number;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  mintMaxAttempts: number;
  /**
   * Legacy config (no longer delays mint). Kept for env compatibility.
   * @deprecated Mint proceeds on Iris complete without waiting for forwarding.
   */
  forwardingFallbackMs: number;
  policy: CctpPolicyConfig;
}
