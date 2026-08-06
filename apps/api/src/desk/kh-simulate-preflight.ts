/**
 * Layer A — optional KeeperHub Direct Execution dry-run before workflow broadcast.
 *
 * Constraints (non-negotiable):
 * - `"simulate": true` only — never DE broadcast for desk production writes
 * - Workflows remain the only write path
 * - Soft default: sim error/revert → record on audit, still execute if policy passed
 * - Optional strict: DESK_KH_SIMULATE_STRICT blocks on wouldRevert, transport failure,
 *   or leg-construction failure (malformed/unsupported workflow must not execute bare)
 *
 * Multi-leg: KeeperHub has no workflow dry-run API (roadmap only). We DE-simulate
 * every material write on the active path (approve + swap + aave + transfer) in
 * parallel with simulate:true. State-dependent reverts (allowance after a co-path
 * approve; balance after a co-path withdraw/swap that itself passed or was waived)
 * are waived for aggregate status so preflight matches real workflow semantics
 * without false blocks — or false passes when the producer leg fails.
 *
 * @see keeperhub/docs/api/direct-execution.md (simulate flag)
 * @see workflows/keeperhub/desk-oracle-arb.workflow.json (approve + swap)
 */

import { SEPOLIA_DESK } from "@chronicleai/config";
import type { DeskStrategy } from "@chronicleai/schemas";
import type { DeskAuditKhSimulate, DeskAuditKhSimulateLeg } from "./execution-audit.ts";
import type { DeskWorkflowAction } from "./execution-bridge.ts";

export const DESK_KH_SIMULATE_PREFLIGHT_DEFAULT = true;
export const DESK_KH_SIMULATE_STRICT_DEFAULT = false;
export const DESK_KH_SIMULATE_TIMEOUT_MS_DEFAULT = 15_000;

/** ERC-20 max uint256 used by desk workflows (`amount: "max"`). */
const ERC20_MAX_UINT256 =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";

/** Aave V3 variable rate (interestRateMode = 2). */
const AAVE_VARIABLE_RATE_MODE = 2;

/** Minimal ABIs for workflow-leg dry-run (production shapes, not mocks). */
const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const AAVE_V3_POOL_ABI = [
  {
    type: "function",
    name: "repay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "interestRateMode", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "supply",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
      { name: "referralCode", type: "uint16" },
    ],
    outputs: [],
  },
] as const;

const UNISWAP_SWAP_ROUTER_ABI = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

export type KhSimulateEndpoint = "contract-call" | "transfer";

export type WorkflowSimulateLegKind =
  | "approve"
  | "swap"
  | "aave_repay"
  | "aave_withdraw"
  | "aave_supply"
  | "transfer";

/** Body sent to KeeperHub DE — always includes simulate: true. */
export interface KhSimulateContractCallBody {
  contractAddress: string;
  chainId: number;
  functionName: string;
  functionArgs: string;
  abi: string;
  /** Must be boolean true — never omit or use string. */
  simulate: true;
  value?: string;
}

export interface KhSimulateTransferBody {
  chainId: number;
  recipientAddress: string;
  amount: string;
  tokenAddress?: string;
  simulate: true;
}

export type KhSimulateRequestBody =
  | KhSimulateContractCallBody
  | KhSimulateTransferBody;

/** One DE dry-run matching a workflow write node on the active path. */
export interface BuiltWorkflowSimulateLeg {
  id: string;
  kind: WorkflowSimulateLegKind;
  endpoint: KhSimulateEndpoint;
  path: "/api/execute/contract-call" | "/api/execute/transfer";
  body: KhSimulateRequestBody;
  /** Human label for notes / logs. */
  label: string;
  /** Token this leg spends (allowance / balance matching). */
  spendToken?: string;
  /** Spender that needs allowance (swap/repay/supply). */
  spender?: string;
  /**
   * Prior leg ids that may produce the balance this leg needs
   * (e.g. swap → supply, withdraw → swap). Used for balance-revert waiver.
   */
  balanceFromLegIds?: string[];
}

/** @deprecated Prefer BuiltWorkflowSimulateLeg — kept for single-leg call sites/tests. */
export type BuiltPrimaryLegSimulate = BuiltWorkflowSimulateLeg;

export interface KhSimulatePreflightConfig {
  apiBaseUrl: string;
  apiKey: string;
  /** Default 11155111 (Ethereum Sepolia desk rail). */
  chainId?: number;
  enabled?: boolean;
  strict?: boolean;
  timeoutMs?: number;
  /** Test inject. */
  fetchImpl?: typeof fetch;
}

export interface PrimaryLegSimulateInput {
  strategy: DeskStrategy | string;
  workflowAction: DeskWorkflowAction | string;
  workflowInput: Record<string, unknown>;
  deskAddress: string;
  /** Free-wallet LINK powder maps to oracle_arb swap. */
  freeLinkPowder?: boolean;
}

/** Alias — same shape; multi-leg preflight uses the same input bag. */
export type WorkflowSimulateInput = PrimaryLegSimulateInput;

export interface KhSimulatePreflightResult {
  khSimulate: DeskAuditKhSimulate;
  /** True when strict mode should abort the workflow execute. */
  shouldBlock: boolean;
  blockReason?: string;
  /** Echo of request metadata for tests / logs (no secrets). */
  requestMeta?: {
    endpoint: KhSimulateEndpoint;
    path: string;
    label: string;
    simulate: true;
    legCount: number;
    legLabels: string[];
  };
}

export interface KhSimulatePreflight {
  isEnabled(): boolean;
  isStrict(): boolean;
  /**
   * Dry-run every material write leg on the active workflow path.
   * Always forces simulate:true; never broadcasts.
   */
  simulateWorkflow(input: WorkflowSimulateInput): Promise<KhSimulatePreflightResult>;
  /**
   * @deprecated Same as simulateWorkflow (full multi-leg). Kept for call-site back-compat.
   */
  simulatePrimaryLeg(input: PrimaryLegSimulateInput): Promise<KhSimulatePreflightResult>;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

function parseChainId(workflowInput: Record<string, unknown>, fallback: number): number {
  const raw = workflowInput.network ?? workflowInput.chainId;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.trunc(raw);
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) return Number(raw.trim());
  return fallback;
}

function requireAddress(value: unknown, field: string): string {
  const s = asNonEmptyString(value);
  if (!s || !/^0x[a-fA-F0-9]{40}$/.test(s)) {
    throw new Error(`Workflow simulate: invalid ${field}`);
  }
  return s;
}

function requireAmountBase(value: unknown, field: string): string {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return String(Math.trunc(value));
  }
  const s = asNonEmptyString(value);
  if (!s || !/^\d+$/.test(s)) {
    throw new Error(`Workflow simulate: invalid ${field} (need base-unit integer)`);
  }
  return s;
}

function addrEq(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function buildApproveLeg(params: {
  id: string;
  label: string;
  token: string;
  spender: string;
  chainId: number;
  amount?: string;
}): BuiltWorkflowSimulateLeg {
  const amount = params.amount ?? ERC20_MAX_UINT256;
  const body: KhSimulateContractCallBody = {
    contractAddress: params.token,
    chainId: params.chainId,
    functionName: "approve",
    functionArgs: JSON.stringify([params.spender, amount]),
    abi: JSON.stringify(ERC20_APPROVE_ABI),
    simulate: true,
  };
  return {
    id: params.id,
    kind: "approve",
    endpoint: "contract-call",
    path: "/api/execute/contract-call",
    body,
    label: params.label,
    spendToken: params.token,
    spender: params.spender,
  };
}

function buildExactInputSingleLeg(params: {
  id: string;
  label: string;
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  fee: number;
  recipient: string;
  amountIn: string;
  amountOutMinimum: string;
  /** Prior leg that may mint tokenIn (e.g. withdraw). */
  balanceFromLegIds?: string[];
}): BuiltWorkflowSimulateLeg {
  const swapParams = {
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    fee: params.fee,
    recipient: params.recipient,
    amountIn: params.amountIn,
    amountOutMinimum: params.amountOutMinimum,
    sqrtPriceLimitX96: "0",
  };
  const body: KhSimulateContractCallBody = {
    contractAddress: SEPOLIA_DESK.uniswapV3SwapRouter02,
    chainId: params.chainId,
    functionName: "exactInputSingle",
    functionArgs: JSON.stringify([swapParams]),
    abi: JSON.stringify(UNISWAP_SWAP_ROUTER_ABI),
    simulate: true,
  };
  return {
    id: params.id,
    kind: "swap",
    endpoint: "contract-call",
    path: "/api/execute/contract-call",
    body,
    label: params.label,
    spendToken: params.tokenIn,
    spender: SEPOLIA_DESK.uniswapV3SwapRouter02,
    ...(params.balanceFromLegIds ? { balanceFromLegIds: params.balanceFromLegIds } : {}),
  };
}

function parseUniswapFee(wi: Record<string, unknown>): number {
  const feeRaw = wi.fee ?? "3000";
  const fee = typeof feeRaw === "number" ? feeRaw : Number(String(feeRaw).trim() || "3000");
  if (!Number.isFinite(fee) || fee < 0) {
    throw new Error("Workflow simulate: invalid Uniswap fee");
  }
  return Math.trunc(fee);
}

function parseAmountOutMinimum(wi: Record<string, unknown>): string {
  return asNonEmptyString(wi.amountOutMinimum) &&
    /^\d+$/.test(String(wi.amountOutMinimum).trim())
    ? String(wi.amountOutMinimum).trim()
    : "0";
}

/**
 * Build DE simulate bodies for every material write on the active workflow path.
 * Mirrors desk-*.workflow.json node sequences (conditions select the branch).
 */
export function buildWorkflowSimulateLegs(
  input: WorkflowSimulateInput,
  chainIdDefault = 11_155_111,
): BuiltWorkflowSimulateLeg[] {
  const chainId = parseChainId(input.workflowInput, chainIdDefault);
  const desk = requireAddress(
    input.deskAddress || input.workflowInput.deskAddress,
    "deskAddress",
  );
  const wi = input.workflowInput;
  const action = input.workflowAction;
  const strategy = input.strategy;
  const freeLinkPowder = input.freeLinkPowder === true;

  // oracle_amm / oracle_arb / free-LINK powder → approve tokenIn + Uniswap swap
  // @see desk-oracle-arb.workflow.json
  if (strategy === "oracle_amm" || action === "oracle_arb" || freeLinkPowder) {
    const tokenIn = requireAddress(wi.tokenIn, "tokenIn");
    const tokenOut = requireAddress(wi.tokenOut, "tokenOut");
    const amountIn = requireAmountBase(wi.amountIn, "amountIn");
    const amountOutMinimum = parseAmountOutMinimum(wi);
    const fee = parseUniswapFee(wi);
    return [
      buildApproveLeg({
        id: "approve-token-in",
        label: "erc20 approve (uniswap router)",
        token: tokenIn,
        spender: SEPOLIA_DESK.uniswapV3SwapRouter02,
        chainId,
      }),
      buildExactInputSingleLeg({
        id: "swap-exact-input",
        label: "uniswap exactInputSingle",
        chainId,
        tokenIn,
        tokenOut,
        fee,
        recipient: desk,
        amountIn,
        amountOutMinimum,
      }),
    ];
  }

  // risk_defend → approve+repay or withdraw
  // @see desk-defend.workflow.json
  if (strategy === "risk_defend" || action === "defend") {
    const mode = asNonEmptyString(wi.mode) ?? "repay";
    const asset = requireAddress(wi.asset, "asset");
    const amount = requireAmountBase(wi.amount, "amount");
    if (mode === "withdraw") {
      const body: KhSimulateContractCallBody = {
        contractAddress: SEPOLIA_DESK.aaveV3Pool,
        chainId,
        functionName: "withdraw",
        functionArgs: JSON.stringify([asset, amount, desk]),
        abi: JSON.stringify(AAVE_V3_POOL_ABI),
        simulate: true,
      };
      return [
        {
          id: "aave-withdraw",
          kind: "aave_withdraw",
          endpoint: "contract-call",
          path: "/api/execute/contract-call",
          body,
          label: "aave-v3 withdraw",
          spendToken: asset,
        },
      ];
    }
    const repayBody: KhSimulateContractCallBody = {
      contractAddress: SEPOLIA_DESK.aaveV3Pool,
      chainId,
      functionName: "repay",
      functionArgs: JSON.stringify([asset, amount, AAVE_VARIABLE_RATE_MODE, desk]),
      abi: JSON.stringify(AAVE_V3_POOL_ABI),
      simulate: true,
    };
    return [
      buildApproveLeg({
        id: "approve-repay-asset",
        label: "erc20 approve (aave pool repay)",
        token: asset,
        spender: SEPOLIA_DESK.aaveV3Pool,
        chainId,
      }),
      {
        id: "aave-repay",
        kind: "aave_repay",
        endpoint: "contract-call",
        path: "/api/execute/contract-call",
        body: repayBody,
        label: "aave-v3 repay",
        spendToken: asset,
        spender: SEPOLIA_DESK.aaveV3Pool,
      },
    ];
  }

  // yield_rotation — branch on direction
  // @see desk-rotate-yield.workflow.json
  if (strategy === "yield_rotation" || action === "rotate") {
    const direction = asNonEmptyString(wi.direction) ?? "into_aave_link";
    if (direction === "out_of_aave_link") {
      const amountLink = requireAmountBase(wi.amountLink, "amountLink");
      const amountIn =
        asNonEmptyString(wi.amountIn) && /^\d+$/.test(String(wi.amountIn).trim())
          ? String(wi.amountIn).trim()
          : amountLink;
      const amountOutMinimum = parseAmountOutMinimum(wi);
      const withdrawBody: KhSimulateContractCallBody = {
        contractAddress: SEPOLIA_DESK.aaveV3Pool,
        chainId,
        functionName: "withdraw",
        functionArgs: JSON.stringify([SEPOLIA_DESK.link, amountLink, desk]),
        abi: JSON.stringify(AAVE_V3_POOL_ABI),
        simulate: true,
      };
      return [
        {
          id: "aave-withdraw-link",
          kind: "aave_withdraw",
          endpoint: "contract-call",
          path: "/api/execute/contract-call",
          body: withdrawBody,
          label: "aave-v3 withdraw (rotate out)",
          spendToken: SEPOLIA_DESK.link,
        },
        buildApproveLeg({
          id: "approve-link-router",
          label: "erc20 approve LINK (uniswap router)",
          token: SEPOLIA_DESK.link,
          spender: SEPOLIA_DESK.uniswapV3SwapRouter02,
          chainId,
        }),
        buildExactInputSingleLeg({
          id: "swap-link-usdc",
          label: "uniswap exactInputSingle (rotate out)",
          chainId,
          tokenIn: SEPOLIA_DESK.link,
          tokenOut: SEPOLIA_DESK.usdc,
          fee: 3000,
          recipient: desk,
          amountIn,
          amountOutMinimum,
          balanceFromLegIds: ["aave-withdraw-link"],
        }),
      ];
    }

    // into_aave_link: approve USDC → swap → approve LINK → supply
    const amountIn = requireAmountBase(wi.amountIn, "amountIn");
    const amountOutMinimum = parseAmountOutMinimum(wi);
    const amountLink =
      asNonEmptyString(wi.amountLink) && /^\d+$/.test(String(wi.amountLink).trim())
        ? String(wi.amountLink).trim()
        : null;
    const legs: BuiltWorkflowSimulateLeg[] = [
      buildApproveLeg({
        id: "approve-usdc-router",
        label: "erc20 approve USDC (uniswap router)",
        token: SEPOLIA_DESK.usdc,
        spender: SEPOLIA_DESK.uniswapV3SwapRouter02,
        chainId,
      }),
      buildExactInputSingleLeg({
        id: "swap-usdc-link",
        label: "uniswap exactInputSingle (rotate in)",
        chainId,
        tokenIn: SEPOLIA_DESK.usdc,
        tokenOut: SEPOLIA_DESK.link,
        fee: 3000,
        recipient: desk,
        amountIn,
        amountOutMinimum,
      }),
      buildApproveLeg({
        id: "approve-link-aave",
        label: "erc20 approve LINK (aave pool)",
        token: SEPOLIA_DESK.link,
        spender: SEPOLIA_DESK.aaveV3Pool,
        chainId,
      }),
    ];
    if (amountLink) {
      const supplyBody: KhSimulateContractCallBody = {
        contractAddress: SEPOLIA_DESK.aaveV3Pool,
        chainId,
        functionName: "supply",
        functionArgs: JSON.stringify([SEPOLIA_DESK.link, amountLink, desk, 0]),
        abi: JSON.stringify(AAVE_V3_POOL_ABI),
        simulate: true,
      };
      legs.push({
        id: "aave-supply-link",
        kind: "aave_supply",
        endpoint: "contract-call",
        path: "/api/execute/contract-call",
        body: supplyBody,
        label: "aave-v3 supply (rotate in)",
        spendToken: SEPOLIA_DESK.link,
        spender: SEPOLIA_DESK.aaveV3Pool,
        balanceFromLegIds: ["swap-usdc-link"],
      });
    }
    return legs;
  }

  // kill / sweep — transfer ± optional Aave withdraw
  // @see desk-kill-switch.workflow.json, desk-sweep.workflow.json
  if (action === "sweep" || action === "kill_switch") {
    const legs: BuiltWorkflowSimulateLeg[] = [];
    const withdrawLink =
      asNonEmptyString(wi.withdrawLink) === "true" || wi.withdrawLink === true;
    if (action === "kill_switch" && withdrawLink) {
      const amountLink =
        asNonEmptyString(wi.amountLink) && /^\d+$/.test(String(wi.amountLink).trim())
          ? String(wi.amountLink).trim()
          : ERC20_MAX_UINT256;
      const withdrawBody: KhSimulateContractCallBody = {
        contractAddress: SEPOLIA_DESK.aaveV3Pool,
        chainId,
        functionName: "withdraw",
        functionArgs: JSON.stringify([SEPOLIA_DESK.link, amountLink, desk]),
        abi: JSON.stringify(AAVE_V3_POOL_ABI),
        simulate: true,
      };
      legs.push({
        id: "aave-withdraw-link",
        kind: "aave_withdraw",
        endpoint: "contract-call",
        path: "/api/execute/contract-call",
        body: withdrawBody,
        label: "aave-v3 withdraw (kill)",
        spendToken: SEPOLIA_DESK.link,
      });
    }
    const amount = asNonEmptyString(wi.amount);
    const treasury = asNonEmptyString(wi.treasuryAddress);
    if (amount && treasury && /^0x[a-fA-F0-9]{40}$/.test(treasury)) {
      const body: KhSimulateTransferBody = {
        chainId,
        recipientAddress: treasury,
        amount,
        tokenAddress: SEPOLIA_DESK.usdc,
        simulate: true,
      };
      legs.push({
        id: "transfer-usdc",
        kind: "transfer",
        endpoint: "transfer",
        path: "/api/execute/transfer",
        body,
        label: "usdc transfer (capital)",
        spendToken: SEPOLIA_DESK.usdc,
      });
    }
    if (legs.length > 0) return legs;
  }

  throw new Error(
    `Workflow simulate: unsupported strategy/action (${strategy}/${action})`,
  );
}

/**
 * Build the DE simulate body for the strategy's primary material write.
 * Prefer buildWorkflowSimulateLegs for full-path preflight.
 * Primary = first non-approve write, else first leg.
 */
export function buildPrimaryLegSimulateRequest(
  input: PrimaryLegSimulateInput,
  chainIdDefault = 11_155_111,
): BuiltPrimaryLegSimulate {
  const legs = buildWorkflowSimulateLegs(input, chainIdDefault);
  const primary =
    legs.find((l) => l.kind !== "approve") ?? legs[0];
  if (!primary) {
    throw new Error("Primary leg simulate: no legs built");
  }
  return primary;
}

/** Hard guard: body must carry boolean simulate:true before any network call. */
export function assertSimulateTrueOnly(body: KhSimulateRequestBody): void {
  if (body.simulate !== true) {
    throw new Error(
      "KH dry-run refused: simulate must be boolean true (no DE broadcast)",
    );
  }
}

interface KhSimulateApiResponse {
  success?: boolean;
  status?: string;
  from?: string;
  to?: string;
  gasEstimate?: string | number;
  wouldRevert?: boolean;
  revertReason?: string | null;
  error?: string | null;
  simulatedReturnValue?: unknown;
  message?: string;
}

function mapSimulateResponse(
  json: KhSimulateApiResponse,
  httpOk: boolean,
  endpoint: KhSimulateEndpoint,
): DeskAuditKhSimulate {
  const wouldRevert = json.wouldRevert === true;
  const gasEstimate =
    json.gasEstimate != null && String(json.gasEstimate).length > 0
      ? String(json.gasEstimate)
      : undefined;
  const from = asNonEmptyString(json.from) ?? undefined;
  const to = asNonEmptyString(json.to) ?? undefined;
  const revertReason =
    asNonEmptyString(json.revertReason) ??
    asNonEmptyString(json.error) ??
    null;

  if (wouldRevert) {
    const result: DeskAuditKhSimulate = {
      attempted: true,
      status: "failed",
      wouldRevert: true,
      endpoint,
      revertReason,
    };
    if (gasEstimate !== undefined) result.gasEstimate = gasEstimate;
    if (from) result.from = from;
    if (to) result.to = to;
    if (revertReason) result.errorMessage = revertReason;
    return result;
  }

  // HTTP error without wouldRevert flag → transport/API error
  if (!httpOk && json.wouldRevert !== false) {
    const msg =
      revertReason ??
      asNonEmptyString(json.message) ??
      asNonEmptyString(json.error) ??
      "KeeperHub dry-run HTTP error";
    return {
      attempted: true,
      status: "error",
      endpoint,
      errorMessage: msg,
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    };
  }

  // success path: status simulated + wouldRevert false
  if (json.wouldRevert === false || json.status === "simulated" || json.success === true) {
    const result: DeskAuditKhSimulate = {
      attempted: true,
      status: "passed",
      wouldRevert: false,
      endpoint,
    };
    if (gasEstimate !== undefined) result.gasEstimate = gasEstimate;
    if (from) result.from = from;
    if (to) result.to = to;
    return result;
  }

  return {
    attempted: true,
    status: "error",
    endpoint,
    errorMessage:
      asNonEmptyString(json.error) ??
      asNonEmptyString(json.message) ??
      "KeeperHub dry-run returned unexpected payload",
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
}

function isAllowanceRevert(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return /allowance|TRANSFER_FROM_FAILED|not.?enough.?allowance|insufficient allowance/i.test(
    reason,
  );
}

function isBalanceRevert(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return /exceeds balance|insufficient (?:balance|funds)|transfer amount exceeds|ERC20: transfer amount/i.test(
    reason,
  );
}

function hasCoveringApprove(
  legs: BuiltWorkflowSimulateLeg[],
  leg: BuiltWorkflowSimulateLeg,
): boolean {
  const spendToken = leg.spendToken;
  const spender = leg.spender;
  if (!spendToken || !spender) return false;
  return legs.some((other) => {
    if (other.kind !== "approve" || other.id === leg.id) return false;
    const otherToken = other.spendToken;
    const otherSpender = other.spender;
    if (!otherToken || !otherSpender) return false;
    return addrEq(otherToken, spendToken) && addrEq(otherSpender, spender);
  });
}

/**
 * True when a prior producer leg would actually fund this leg in real workflow
 * order. Parallel DE sims cannot apply intermediate state, so a balance revert
 * on the consumer is only waived when at least one producer effectively
 * succeeds — not merely because the producer leg exists on the path.
 *
 * "Effectively succeeds" = dry-run passed, or the producer itself was waived
 * for a state dependency (e.g. swap allowance covered by co-path approve).
 * A would-revert / transport error / missing result does not cover balance.
 */
function producerEffectivelySucceeds(
  priorResult: DeskAuditKhSimulateLeg | undefined,
): boolean {
  if (!priorResult) return false;
  if (priorResult.status === "passed") return true;
  if (priorResult.waived === true) return true;
  return false;
}

function hasCoveringBalanceSource(
  legs: BuiltWorkflowSimulateLeg[],
  leg: BuiltWorkflowSimulateLeg,
  legResults: Map<string, DeskAuditKhSimulateLeg>,
): boolean {
  const ids = leg.balanceFromLegIds;
  if (!ids || ids.length === 0) return false;
  return ids.some((id) => {
    const prior = legs.find((l) => l.id === id);
    if (!prior) return false;
    return producerEffectivelySucceeds(legResults.get(id));
  });
}

function skippedResult(
  reason: string,
  shouldBlock: boolean,
): KhSimulatePreflightResult {
  return {
    khSimulate: {
      attempted: false,
      status: "skipped",
      errorMessage: reason,
    },
    shouldBlock,
    ...(shouldBlock ? { blockReason: reason } : {}),
  };
}

function sumGasEstimates(legs: DeskAuditKhSimulateLeg[]): string | undefined {
  let total = 0n;
  let any = false;
  for (const leg of legs) {
    if (!leg.gasEstimate || !/^\d+$/.test(leg.gasEstimate)) continue;
    try {
      total += BigInt(leg.gasEstimate);
      any = true;
    } catch {
      // ignore non-bigint-safe
    }
  }
  return any ? total.toString() : undefined;
}

function aggregateLegResults(
  builtLegs: BuiltWorkflowSimulateLeg[],
  rawById: Map<string, DeskAuditKhSimulate>,
): {
  khSimulate: DeskAuditKhSimulate;
  shouldBlockStrict: boolean;
} {
  const legResults: DeskAuditKhSimulateLeg[] = [];
  const byId = new Map<string, DeskAuditKhSimulateLeg>();

  // First pass: map raw → leg rows (no waiver yet for ordering independence)
  for (const built of builtLegs) {
    const raw = rawById.get(built.id);
    if (!raw) {
      const row: DeskAuditKhSimulateLeg = {
        id: built.id,
        label: built.label,
        kind: built.kind,
        status: "error",
        endpoint: built.endpoint,
        errorMessage: "Missing dry-run result for leg",
      };
      legResults.push(row);
      byId.set(built.id, row);
      continue;
    }
    const row: DeskAuditKhSimulateLeg = {
      id: built.id,
      label: built.label,
      kind: built.kind,
      status: raw.status,
      endpoint: raw.endpoint ?? built.endpoint,
    };
    if (raw.wouldRevert !== undefined) row.wouldRevert = raw.wouldRevert;
    if (raw.gasEstimate) row.gasEstimate = raw.gasEstimate;
    if (raw.revertReason != null) row.revertReason = raw.revertReason;
    if (raw.errorMessage != null) row.errorMessage = raw.errorMessage;
    if (raw.from) row.from = raw.from;
    if (raw.to) row.to = raw.to;
    legResults.push(row);
    byId.set(built.id, row);
  }

  // Second pass: state-dependency waivers (workflow would succeed end-to-end).
  // Allowance first — co-path approve does not depend on other leg results.
  // Then balance, iterated to fixed point so a producer waived for allowance
  // can cover a downstream consumer (and multi-hop produce chains).
  for (let i = 0; i < builtLegs.length; i++) {
    const built = builtLegs[i]!;
    const row = legResults[i]!;
    if (row.status !== "failed" || row.wouldRevert !== true) continue;
    if (row.waived) continue;

    const reason = row.revertReason ?? row.errorMessage ?? null;
    if (isAllowanceRevert(reason) && hasCoveringApprove(builtLegs, built)) {
      row.waived = true;
      row.waiveReason = "allowance_covered_by_workflow_approve";
      // Aggregate treats waived reverts as non-blocking; keep raw wouldRevert for audit.
    }
  }

  let balanceWaiverProgressed = true;
  while (balanceWaiverProgressed) {
    balanceWaiverProgressed = false;
    for (let i = 0; i < builtLegs.length; i++) {
      const built = builtLegs[i]!;
      const row = legResults[i]!;
      if (row.status !== "failed" || row.wouldRevert !== true) continue;
      if (row.waived) continue;

      const reason = row.revertReason ?? row.errorMessage ?? null;
      if (
        isBalanceRevert(reason) &&
        hasCoveringBalanceSource(builtLegs, built, byId)
      ) {
        row.waived = true;
        row.waiveReason = "balance_covered_by_prior_workflow_leg";
        balanceWaiverProgressed = true;
      }
    }
  }

  const blockingFailed = legResults.filter(
    (l) =>
      !l.waived &&
      (l.status === "failed" || (l.wouldRevert === true && l.status !== "passed")),
  );
  const blockingErrors = legResults.filter(
    (l) => !l.waived && l.status === "error",
  );
  const passedCount = legResults.filter(
    (l) => l.status === "passed" || l.waived === true,
  ).length;

  let status: DeskAuditKhSimulate["status"];
  let wouldRevert: boolean | undefined;
  let revertReason: string | null | undefined;
  let errorMessage: string | null | undefined;
  let endpoint: KhSimulateEndpoint | undefined;

  if (blockingFailed.length > 0) {
    status = "failed";
    wouldRevert = true;
    const first = blockingFailed[0]!;
    revertReason = first.revertReason ?? first.errorMessage ?? null;
    errorMessage = revertReason;
    endpoint = first.endpoint;
  } else if (blockingErrors.length > 0) {
    status = "error";
    const first = blockingErrors[0]!;
    errorMessage = first.errorMessage ?? "KeeperHub dry-run leg error";
    endpoint = first.endpoint;
  } else {
    status = "passed";
    wouldRevert = false;
    // Prefer primary material (non-approve) endpoint for top-level display
    const primary =
      legResults.find((l) => l.kind !== "approve" && l.status === "passed") ??
      legResults.find((l) => l.status === "passed") ??
      legResults[0];
    endpoint = primary?.endpoint;
  }

  const gasEstimate = sumGasEstimates(
    legResults.filter((l) => l.status === "passed" || l.waived),
  );

  // Surface a non-waived failure reason; else first waived note for soft audit
  if (!errorMessage && status === "passed") {
    const waived = legResults.find((l) => l.waived);
    if (waived?.revertReason) {
      // Keep top-level clean on pass — detail lives in legs[]
    }
  }

  const from =
    legResults.find((l) => l.from)?.from ??
    undefined;
  const to =
    legResults.find((l) => l.kind !== "approve" && l.to)?.to ??
    legResults.find((l) => l.to)?.to ??
    undefined;

  const khSimulate: DeskAuditKhSimulate = {
    attempted: true,
    status,
    endpoint,
    legs: legResults,
    legCount: legResults.length,
    passedLegs: passedCount,
    failedLegs: blockingFailed.length + blockingErrors.length,
  };
  if (wouldRevert !== undefined) khSimulate.wouldRevert = wouldRevert;
  if (gasEstimate !== undefined) khSimulate.gasEstimate = gasEstimate;
  if (revertReason !== undefined && revertReason !== null) {
    khSimulate.revertReason = revertReason;
  }
  if (errorMessage !== undefined && errorMessage !== null) {
    khSimulate.errorMessage = errorMessage;
  }
  if (from) khSimulate.from = from;
  if (to) khSimulate.to = to;

  const shouldBlockStrict =
    blockingFailed.length > 0 || blockingErrors.length > 0;

  return { khSimulate, shouldBlockStrict };
}

async function simulateOneLeg(
  built: BuiltWorkflowSimulateLeg,
  params: {
    baseUrl: string;
    apiKey: string;
    timeoutMs: number;
    fetchImpl: typeof fetch;
  },
): Promise<DeskAuditKhSimulate> {
  assertSimulateTrueOnly(built.body);
  const url = `${params.baseUrl}${built.path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);

  try {
    const res = await params.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(built.body),
      signal: controller.signal,
    });

    let json: KhSimulateApiResponse = {};
    try {
      json = (await res.json()) as KhSimulateApiResponse;
    } catch {
      json = {
        error: `KeeperHub dry-run non-JSON response (HTTP ${res.status})`,
      };
    }

    return mapSimulateResponse(json, res.ok, built.endpoint);
  } catch (error) {
    const aborted =
      error instanceof Error &&
      (error.name === "AbortError" || /aborted/i.test(error.message));
    const msg = aborted
      ? `KeeperHub dry-run timed out after ${params.timeoutMs}ms`
      : error instanceof Error
        ? error.message
        : "KeeperHub dry-run transport error";
    return {
      attempted: true,
      status: "error",
      endpoint: built.endpoint,
      errorMessage: msg,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function createKhSimulatePreflight(
  config: KhSimulatePreflightConfig,
): KhSimulatePreflight {
  const baseUrl = config.apiBaseUrl.replace(/\/+$/, "");
  const enabled = config.enabled === true;
  const strict = config.strict === true;
  const timeoutMs = config.timeoutMs ?? DESK_KH_SIMULATE_TIMEOUT_MS_DEFAULT;
  const chainIdDefault = config.chainId ?? 11_155_111;
  const fetchImpl = config.fetchImpl ?? fetch;

  async function runWorkflowSimulate(
    input: WorkflowSimulateInput,
  ): Promise<KhSimulatePreflightResult> {
    if (!enabled) {
      return skippedResult("DESK_KH_SIMULATE_PREFLIGHT disabled", false);
    }

    let builtLegs: BuiltWorkflowSimulateLeg[];
    try {
      builtLegs = buildWorkflowSimulateLegs(input, chainIdDefault);
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : "Failed to build workflow simulate requests";
      // Build failure is not a chain revert: soft continues with an honest
      // skip (shape unsupported, no sim attempted). Strict must fail closed —
      // otherwise a malformed/unsupported workflow executes without preflight.
      if (strict) {
        return {
          khSimulate: {
            attempted: false,
            status: "error",
            errorMessage: msg,
          },
          shouldBlock: true,
          blockReason: "kh_simulate_error",
        };
      }
      return {
        khSimulate: {
          attempted: false,
          status: "skipped",
          errorMessage: msg,
        },
        shouldBlock: false,
      };
    }

    if (builtLegs.length === 0) {
      return skippedResult("No material write legs to dry-run", false);
    }

    for (const leg of builtLegs) {
      assertSimulateTrueOnly(leg.body);
    }

    // Parallel DE simulates — each is an independent eth_call on current state.
    const rawResults = await Promise.all(
      builtLegs.map((leg) =>
        simulateOneLeg(leg, {
          baseUrl,
          apiKey: config.apiKey,
          timeoutMs,
          fetchImpl,
        }),
      ),
    );

    const rawById = new Map<string, DeskAuditKhSimulate>();
    for (let i = 0; i < builtLegs.length; i++) {
      rawById.set(builtLegs[i]!.id, rawResults[i]!);
    }

    const { khSimulate, shouldBlockStrict } = aggregateLegResults(
      builtLegs,
      rawById,
    );

    const shouldBlock = strict && shouldBlockStrict;
    let blockReason: string | undefined;
    if (shouldBlock) {
      blockReason =
        khSimulate.wouldRevert === true
          ? "kh_simulate_would_revert"
          : "kh_simulate_error";
    }

    const primary =
      builtLegs.find((l) => l.kind !== "approve") ?? builtLegs[0]!;

    return {
      khSimulate,
      shouldBlock,
      ...(blockReason ? { blockReason } : {}),
      requestMeta: {
        endpoint: primary.endpoint,
        path: primary.path,
        label: builtLegs.map((l) => l.label).join(" → "),
        simulate: true,
        legCount: builtLegs.length,
        legLabels: builtLegs.map((l) => l.label),
      },
    };
  }

  return {
    isEnabled: () => enabled,
    isStrict: () => strict,

    simulateWorkflow: runWorkflowSimulate,
    simulatePrimaryLeg: runWorkflowSimulate,
  };
}

export function createKhSimulatePreflightFromEnv(
  env: {
    keeperhubApiBaseUrl?: string | undefined;
    keeperhubApiKey?: string | undefined;
    deskKhSimulatePreflight?: boolean | undefined;
    deskKhSimulateStrict?: boolean | undefined;
    deskKhSimulateTimeoutMs?: number | undefined;
    keeperhubNetwork?: string | undefined;
  },
  options?: { fetchImpl?: typeof fetch },
): KhSimulatePreflight | null {
  const base = env.keeperhubApiBaseUrl?.trim();
  const key = env.keeperhubApiKey?.trim();
  if (!base || !key || !key.startsWith("kh_")) {
    return null;
  }
  if (env.deskKhSimulatePreflight !== true) {
    // Still return a disabled client so callers can call isEnabled() without null checks.
    return createKhSimulatePreflight({
      apiBaseUrl: base,
      apiKey: key,
      enabled: false,
      strict: env.deskKhSimulateStrict === true,
      timeoutMs: env.deskKhSimulateTimeoutMs ?? DESK_KH_SIMULATE_TIMEOUT_MS_DEFAULT,
      fetchImpl: options?.fetchImpl,
    });
  }
  return createKhSimulatePreflight({
    apiBaseUrl: base,
    apiKey: key,
    enabled: true,
    strict: env.deskKhSimulateStrict === true,
    timeoutMs: env.deskKhSimulateTimeoutMs ?? DESK_KH_SIMULATE_TIMEOUT_MS_DEFAULT,
    chainId: 11_155_111,
    fetchImpl: options?.fetchImpl,
  });
}
