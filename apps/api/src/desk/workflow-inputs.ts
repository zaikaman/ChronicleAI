/**
 * Map strategy plans / capital actions → KeeperHub workflow trigger inputs.
 * Protocol actions expect base units (wei); transfer-token expects human USDC.
 * No mocked amounts — callers must supply real balances / sized notionals.
 */

import { SEPOLIA_DESK } from "@chronicleai/config";
import { getAddress, parseUnits } from "viem";
import type { DeskStrategy } from "@chronicleai/schemas";
import type { DeskWorkflowAction } from "./execution-bridge.ts";
import type { DeskLeg, StrategyPlan } from "./types.ts";

/** Aave max withdraw sentinel (type(uint256).max). */
export const AAVE_MAX_UINT256 =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";

export const DESK_TOKEN_ADDRESSES = {
  USDC: SEPOLIA_DESK.usdc,
  WETH: SEPOLIA_DESK.weth,
  LINK: SEPOLIA_DESK.link,
} as const;

export type DeskTokenSymbol = keyof typeof DESK_TOKEN_ADDRESSES;

const TOKEN_DECIMALS: Record<DeskTokenSymbol, number> = {
  USDC: 6,
  WETH: 18,
  LINK: 18,
};

export function resolveTokenAddress(symbolOrAddress: string): string {
  const key = symbolOrAddress.trim().toUpperCase();
  if (key in DESK_TOKEN_ADDRESSES) {
    return DESK_TOKEN_ADDRESSES[key as DeskTokenSymbol];
  }
  if (/^0x[a-fA-F0-9]{40}$/.test(symbolOrAddress.trim())) {
    return getAddress(symbolOrAddress.trim());
  }
  throw new Error(`Unknown desk token or address: ${symbolOrAddress}`);
}

export function tokenDecimals(symbolOrAddress: string): number {
  const key = symbolOrAddress.trim().toUpperCase();
  if (key in TOKEN_DECIMALS) return TOKEN_DECIMALS[key as DeskTokenSymbol];
  // Address path: infer known Sepolia tokens
  const lower = symbolOrAddress.trim().toLowerCase();
  if (lower === SEPOLIA_DESK.usdc.toLowerCase()) return 6;
  if (lower === SEPOLIA_DESK.weth.toLowerCase()) return 18;
  if (lower === SEPOLIA_DESK.link.toLowerCase()) return 18;
  return 18;
}

/** Convert human amount string/number → base-unit string for protocol actions. */
export function toBaseUnits(human: string | number, decimals: number): string {
  const s = typeof human === "number" ? String(human) : human.trim();
  if (!s || s === "min(policy,balance)") {
    throw new Error(`Cannot convert unresolved amount to base units: ${s}`);
  }
  // Already base units (integer string with no decimal)?
  if (/^\d+$/.test(s) && s.length > 12) {
    return s;
  }
  return parseUnits(s, decimals).toString();
}

/**
 * Resolve amount = min(policy cap, available balance) in human units.
 * Used for pre-trade sizing on rotation / defend legs.
 */
export function minPolicyBalance(
  policyCapHuman: number,
  balanceHuman: number,
): number {
  if (!Number.isFinite(policyCapHuman) || policyCapHuman <= 0) return 0;
  if (!Number.isFinite(balanceHuman) || balanceHuman <= 0) return 0;
  return Math.min(policyCapHuman, balanceHuman);
}

export interface DefendWorkflowInput {
  mode: "repay" | "withdraw";
  asset: string;
  /** Base units for Aave repay/withdraw. */
  amount: string;
  deskAddress: string;
  network?: string | undefined;
  intentId?: string | undefined;
  strategy?: "risk_defend" | undefined;
}

export interface RotateWorkflowInput {
  direction: "into_aave_link" | "out_of_aave_link";
  deskAddress: string;
  /** Swap amountIn base units. */
  amountIn: string;
  /** Min out base units (slippage guard; 0 allowed on thin testnet). */
  amountOutMinimum: string;
  /** LINK amount base units for supply or withdraw. */
  amountLink: string;
  network?: string | undefined;
  intentId?: string | undefined;
  strategy?: "yield_rotation" | undefined;
}

export interface OracleArbWorkflowInput {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOutMinimum: string;
  deskAddress: string;
  fee: string;
  network?: string | undefined;
  intentId?: string | undefined;
  strategy?: "oracle_amm" | undefined;
  basisBps?: number | undefined;
}

export interface SweepWorkflowInput {
  amount: string;
  treasuryAddress: string;
  deskAddress?: string | undefined;
  reason?: string | undefined;
  network?: string | undefined;
}

export interface KillSwitchWorkflowInput {
  amount: string;
  treasuryAddress: string;
  deskAddress: string;
  withdrawLink: "true" | "false";
  /** Base units or AAVE_MAX_UINT256 when withdrawing all. */
  amountLink: string;
  reason?: string | undefined;
  network?: string | undefined;
}

function primaryLeg(legs: DeskLeg[]): DeskLeg {
  if (legs.length === 0) {
    throw new Error("Strategy plan has no legs");
  }
  return legs[0]!;
}

/**
 * Build defend workflow input from a proposed risk_defend plan (first repay/withdraw leg).
 */
export function buildDefendInput(params: {
  legs: DeskLeg[];
  deskAddress: string;
  intentId?: string | undefined;
}): DefendWorkflowInput {
  const repay = params.legs.find((l) => l.action === "repay");
  const withdraw = params.legs.find((l) => l.action === "withdraw");
  const leg = repay ?? withdraw ?? primaryLeg(params.legs);
  const mode = leg.action === "withdraw" ? "withdraw" : "repay";
  const assetSym = leg.asset ?? "USDC";
  const asset = resolveTokenAddress(assetSym);
  const decimals = tokenDecimals(assetSym);
  const human = leg.amount ?? "0";
  return {
    mode,
    asset,
    amount: toBaseUnits(human, decimals),
    deskAddress: getAddress(params.deskAddress),
    network: "11155111",
    intentId: params.intentId,
    strategy: "risk_defend",
  };
}

/**
 * Build rotation workflow input. Resolves min(policy, balance) when supply amount is placeholder.
 */
export function buildRotateInput(params: {
  legs: DeskLeg[];
  deskAddress: string;
  freeUsdc: number;
  maxTradeUsdc: number;
  /** Estimated LINK human amount for supply after swap (from price). */
  estimatedLinkHuman?: number | undefined;
  /** LINK free / supplied for exit path. */
  linkBalanceHuman?: number | undefined;
  amountOutMinimumBase?: string | undefined;
  intentId?: string | undefined;
}): RotateWorkflowInput {
  const legs = params.legs;
  const into =
    legs.some((l) => l.note === "rotate_usdc_to_link" || l.action === "supply") &&
    legs.some((l) => l.protocol === "uniswap");
  const out = legs.some((l) => l.note === "rotate_out_withdraw_link");

  const direction: RotateWorkflowInput["direction"] = out && !into
    ? "out_of_aave_link"
    : "into_aave_link";

  if (direction === "into_aave_link") {
    const swap = legs.find((l) => l.action === "swap-exact-input") ?? primaryLeg(legs);
    const notionalHuman = minPolicyBalance(
      Number(swap.amountIn ?? params.maxTradeUsdc),
      Math.min(params.freeUsdc, params.maxTradeUsdc),
    );
    if (notionalHuman <= 0) {
      throw new Error("Rotation into Aave: no USDC available after min(policy, balance)");
    }
    const amountIn = toBaseUnits(notionalHuman, 6);
    const linkHuman =
      params.estimatedLinkHuman != null && params.estimatedLinkHuman > 0
        ? params.estimatedLinkHuman
        : notionalHuman; // caller should pass priced estimate; fallback keeps demo path explicit
    const supplyLeg = legs.find((l) => l.action === "supply");
    const supplyHumanRaw = supplyLeg?.amount;
    const supplyHuman =
      supplyHumanRaw && supplyHumanRaw !== "min(policy,balance)"
        ? Number(supplyHumanRaw)
        : linkHuman;
    return {
      direction,
      deskAddress: getAddress(params.deskAddress),
      amountIn,
      amountOutMinimum: params.amountOutMinimumBase ?? "0",
      amountLink: toBaseUnits(supplyHuman, 18),
      network: "11155111",
      intentId: params.intentId,
      strategy: "yield_rotation",
    };
  }

  // out_of_aave_link
  const withdraw = legs.find((l) => l.action === "withdraw") ?? primaryLeg(legs);
  const swap = legs.find((l) => l.action === "swap-exact-input");
  const linkHuman = minPolicyBalance(
    Number(withdraw.amount ?? params.linkBalanceHuman ?? 0),
    params.linkBalanceHuman ?? Number(withdraw.amount ?? 0),
  );
  if (linkHuman <= 0) {
    throw new Error("Rotation out of Aave: no LINK available after min(policy, balance)");
  }
  const amountLink = toBaseUnits(linkHuman, 18);
  return {
    direction,
    deskAddress: getAddress(params.deskAddress),
    amountIn: swap?.amountIn
      ? toBaseUnits(swap.amountIn, 18)
      : amountLink,
    amountOutMinimum: params.amountOutMinimumBase ?? "0",
    amountLink,
    network: "11155111",
    intentId: params.intentId,
    strategy: "yield_rotation",
  };
}

export function buildOracleArbInput(params: {
  legs: DeskLeg[];
  deskAddress: string;
  fee?: string | undefined;
  amountOutMinimumBase?: string | undefined;
  basisBps?: number | undefined;
  intentId?: string | undefined;
}): OracleArbWorkflowInput {
  const leg =
    params.legs.find((l) => l.action === "swap-exact-input") ?? primaryLeg(params.legs);
  const tokenInSym = leg.tokenIn ?? "USDC";
  const tokenOutSym = leg.tokenOut ?? "WETH";
  const tokenIn = resolveTokenAddress(tokenInSym);
  const tokenOut = resolveTokenAddress(tokenOutSym);
  const decimals = tokenDecimals(tokenInSym);
  const amountInHuman = leg.amountIn ?? "0";
  return {
    tokenIn,
    tokenOut,
    amountIn: toBaseUnits(amountInHuman, decimals),
    amountOutMinimum: params.amountOutMinimumBase ?? leg.amountOutMin ?? "0",
    deskAddress: getAddress(params.deskAddress),
    fee: params.fee ?? "3000",
    network: "11155111",
    intentId: params.intentId,
    strategy: "oracle_amm",
    basisBps: params.basisBps,
  };
}

export function buildSweepInput(params: {
  amountUsdc: number;
  treasuryAddress: string;
  deskAddress?: string | undefined;
  reason?: string | undefined;
}): SweepWorkflowInput {
  if (params.amountUsdc <= 0) {
    throw new Error("Sweep amount must be positive");
  }
  return {
    amount: String(params.amountUsdc),
    treasuryAddress: getAddress(params.treasuryAddress),
    deskAddress: params.deskAddress
      ? getAddress(params.deskAddress)
      : undefined,
    reason: params.reason,
    network: "11155111",
  };
}

export function buildKillSwitchInput(params: {
  amountUsdc: number;
  treasuryAddress: string;
  deskAddress: string;
  /** When true, withdraw LINK from Aave before USDC return. */
  withdrawLink?: boolean | undefined;
  /** LINK base units; defaults to max uint when withdrawing. */
  amountLinkBase?: string | undefined;
  reason?: string | undefined;
}): KillSwitchWorkflowInput {
  if (params.amountUsdc < 0) {
    throw new Error("Kill-switch USDC amount cannot be negative");
  }
  const withdraw = params.withdrawLink === true;
  return {
    amount: String(params.amountUsdc),
    treasuryAddress: getAddress(params.treasuryAddress),
    deskAddress: getAddress(params.deskAddress),
    withdrawLink: withdraw ? "true" : "false",
    amountLink: withdraw
      ? (params.amountLinkBase ?? AAVE_MAX_UINT256)
      : "0",
    reason: params.reason,
    network: "11155111",
  };
}

/**
 * Build KH workflow input bag for a propose plan + strategy.
 */
export function buildWorkflowInputForPlan(params: {
  plan: Extract<StrategyPlan, { action: "propose" }>;
  deskAddress: string;
  freeUsdc: number;
  maxTradeUsdc: number;
  estimatedLinkHuman?: number | undefined;
  linkBalanceHuman?: number | undefined;
  intentId?: string | undefined;
  basisBps?: number | undefined;
  /**
   * When true, yield_rotation free-wallet LINK→USDC powder maps to the
   * oracle_arb single-swap workflow (not Aave rotate).
   */
  freeLinkPowder?: boolean | undefined;
}): Record<string, unknown> {
  const { plan } = params;
  switch (plan.strategy) {
    case "risk_defend":
      return buildDefendInput({
        legs: plan.legs,
        deskAddress: params.deskAddress,
        intentId: params.intentId,
      }) as unknown as Record<string, unknown>;
    case "yield_rotation":
      if (params.freeLinkPowder) {
        return buildOracleArbInput({
          legs: plan.legs,
          deskAddress: params.deskAddress,
          intentId: params.intentId,
        }) as unknown as Record<string, unknown>;
      }
      return buildRotateInput({
        legs: plan.legs,
        deskAddress: params.deskAddress,
        freeUsdc: params.freeUsdc,
        maxTradeUsdc: params.maxTradeUsdc,
        estimatedLinkHuman: params.estimatedLinkHuman,
        linkBalanceHuman: params.linkBalanceHuman,
        intentId: params.intentId,
      }) as unknown as Record<string, unknown>;
    case "oracle_amm":
      return buildOracleArbInput({
        legs: plan.legs,
        deskAddress: params.deskAddress,
        basisBps: params.basisBps,
        intentId: params.intentId,
      }) as unknown as Record<string, unknown>;
    default: {
      const _exhaustive: never = plan.strategy;
      throw new Error(`Unsupported strategy for workflow input: ${_exhaustive}`);
    }
  }
}

export function workflowActionForStrategy(
  strategy: DeskStrategy,
): DeskWorkflowAction {
  switch (strategy) {
    case "risk_defend":
      return "defend";
    case "yield_rotation":
      return "rotate";
    case "oracle_amm":
      return "oracle_arb";
    default: {
      const _exhaustive: never = strategy;
      throw new Error(`Unknown strategy: ${_exhaustive}`);
    }
  }
}
