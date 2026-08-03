/**
 * Layer A — optional KeeperHub Direct Execution dry-run before workflow broadcast.
 *
 * Constraints (non-negotiable):
 * - `"simulate": true` only — never DE broadcast for desk production writes
 * - Workflows remain the only write path
 * - Soft default: sim error/revert → record on audit, still execute if policy passed
 * - Optional strict: DESK_KH_SIMULATE_STRICT blocks on wouldRevert or transport failure
 *
 * @see keeperhub/docs/api/direct-execution.md (simulate flag)
 */

import { SEPOLIA_DESK } from "@chronicleai/config";
import type { DeskStrategy } from "@chronicleai/schemas";
import type { DeskAuditKhSimulate } from "./execution-audit.ts";
import type { DeskWorkflowAction } from "./execution-bridge.ts";

export const DESK_KH_SIMULATE_PREFLIGHT_DEFAULT = true;
export const DESK_KH_SIMULATE_STRICT_DEFAULT = false;
export const DESK_KH_SIMULATE_TIMEOUT_MS_DEFAULT = 15_000;

/** Aave V3 variable rate (interestRateMode = 2). */
const AAVE_VARIABLE_RATE_MODE = 2;

/** Minimal ABIs for primary-leg dry-run (production shapes, not mocks). */
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

export interface BuiltPrimaryLegSimulate {
  endpoint: KhSimulateEndpoint;
  path: "/api/execute/contract-call" | "/api/execute/transfer";
  body: KhSimulateRequestBody;
  /** Human label for notes / logs. */
  label: string;
}

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
  };
}

export interface KhSimulatePreflight {
  isEnabled(): boolean;
  isStrict(): boolean;
  /**
   * Best-effort dry-run of the primary material write leg.
   * Always forces simulate:true; never broadcasts.
   */
  simulatePrimaryLeg(
    input: PrimaryLegSimulateInput,
  ): Promise<KhSimulatePreflightResult>;
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
    throw new Error(`Primary leg simulate: invalid ${field}`);
  }
  return s;
}

function requireAmountBase(value: unknown, field: string): string {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return String(Math.trunc(value));
  }
  const s = asNonEmptyString(value);
  if (!s || !/^\d+$/.test(s)) {
    throw new Error(`Primary leg simulate: invalid ${field} (need base-unit integer)`);
  }
  return s;
}

/**
 * Build the DE simulate body for the strategy's primary material write.
 * Multi-leg workflows only dry-run one primary leg (plan §3.2).
 */
export function buildPrimaryLegSimulateRequest(
  input: PrimaryLegSimulateInput,
  chainIdDefault = 11_155_111,
): BuiltPrimaryLegSimulate {
  const chainId = parseChainId(input.workflowInput, chainIdDefault);
  const desk = requireAddress(
    input.deskAddress || input.workflowInput.deskAddress,
    "deskAddress",
  );
  const wi = input.workflowInput;
  const action = input.workflowAction;
  const strategy = input.strategy;
  const freeLinkPowder = input.freeLinkPowder === true;

  // oracle_amm or free-LINK powder → Uniswap exactInputSingle
  if (
    strategy === "oracle_amm" ||
    action === "oracle_arb" ||
    freeLinkPowder
  ) {
    const tokenIn = requireAddress(wi.tokenIn, "tokenIn");
    const tokenOut = requireAddress(wi.tokenOut, "tokenOut");
    const amountIn = requireAmountBase(wi.amountIn, "amountIn");
    const amountOutMinimum =
      asNonEmptyString(wi.amountOutMinimum) && /^\d+$/.test(String(wi.amountOutMinimum).trim())
        ? String(wi.amountOutMinimum).trim()
        : "0";
    const feeRaw = wi.fee ?? "3000";
    const fee = typeof feeRaw === "number" ? feeRaw : Number(String(feeRaw).trim() || "3000");
    if (!Number.isFinite(fee) || fee < 0) {
      throw new Error("Primary leg simulate: invalid Uniswap fee");
    }
    const params = {
      tokenIn,
      tokenOut,
      fee: Math.trunc(fee),
      recipient: desk,
      amountIn,
      amountOutMinimum,
      sqrtPriceLimitX96: "0",
    };
    const body: KhSimulateContractCallBody = {
      contractAddress: SEPOLIA_DESK.uniswapV3SwapRouter02,
      chainId,
      functionName: "exactInputSingle",
      functionArgs: JSON.stringify([params]),
      abi: JSON.stringify(UNISWAP_SWAP_ROUTER_ABI),
      simulate: true,
    };
    return {
      endpoint: "contract-call",
      path: "/api/execute/contract-call",
      body,
      label: "uniswap exactInputSingle",
    };
  }

  // risk_defend → Aave repay or withdraw
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
      return {
        endpoint: "contract-call",
        path: "/api/execute/contract-call",
        body,
        label: "aave-v3 withdraw",
      };
    }
    const body: KhSimulateContractCallBody = {
      contractAddress: SEPOLIA_DESK.aaveV3Pool,
      chainId,
      functionName: "repay",
      functionArgs: JSON.stringify([asset, amount, AAVE_VARIABLE_RATE_MODE, desk]),
      abi: JSON.stringify(AAVE_V3_POOL_ABI),
      simulate: true,
    };
    return {
      endpoint: "contract-call",
      path: "/api/execute/contract-call",
      body,
      label: "aave-v3 repay",
    };
  }

  // yield_rotation → primary leg only
  if (strategy === "yield_rotation" || action === "rotate") {
    const direction = asNonEmptyString(wi.direction) ?? "into_aave_link";
    if (direction === "out_of_aave_link") {
      // Primary: withdraw LINK from Aave (swap is secondary).
      const amountLink = requireAmountBase(wi.amountLink, "amountLink");
      const body: KhSimulateContractCallBody = {
        contractAddress: SEPOLIA_DESK.aaveV3Pool,
        chainId,
        functionName: "withdraw",
        functionArgs: JSON.stringify([SEPOLIA_DESK.link, amountLink, desk]),
        abi: JSON.stringify(AAVE_V3_POOL_ABI),
        simulate: true,
      };
      return {
        endpoint: "contract-call",
        path: "/api/execute/contract-call",
        body,
        label: "aave-v3 withdraw (rotate out)",
      };
    }
    // into_aave_link: primary material write is USDC→LINK swap
    const amountIn = requireAmountBase(wi.amountIn, "amountIn");
    const amountOutMinimum =
      asNonEmptyString(wi.amountOutMinimum) && /^\d+$/.test(String(wi.amountOutMinimum).trim())
        ? String(wi.amountOutMinimum).trim()
        : "0";
    const params = {
      tokenIn: SEPOLIA_DESK.usdc,
      tokenOut: SEPOLIA_DESK.link,
      fee: 3000,
      recipient: desk,
      amountIn,
      amountOutMinimum,
      sqrtPriceLimitX96: "0",
    };
    const body: KhSimulateContractCallBody = {
      contractAddress: SEPOLIA_DESK.uniswapV3SwapRouter02,
      chainId,
      functionName: "exactInputSingle",
      functionArgs: JSON.stringify([params]),
      abi: JSON.stringify(UNISWAP_SWAP_ROUTER_ABI),
      simulate: true,
    };
    return {
      endpoint: "contract-call",
      path: "/api/execute/contract-call",
      body,
      label: "uniswap exactInputSingle (rotate in)",
    };
  }

  // kill / sweep — optional transfer dry-run when amount + treasury present
  if (action === "sweep" || action === "kill_switch") {
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
      return {
        endpoint: "transfer",
        path: "/api/execute/transfer",
        body,
        label: "usdc transfer (capital)",
      };
    }
  }

  throw new Error(
    `Primary leg simulate: unsupported strategy/action (${strategy}/${action})`,
  );
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

export function createKhSimulatePreflight(
  config: KhSimulatePreflightConfig,
): KhSimulatePreflight {
  const baseUrl = config.apiBaseUrl.replace(/\/+$/, "");
  const enabled = config.enabled === true;
  const strict = config.strict === true;
  const timeoutMs = config.timeoutMs ?? DESK_KH_SIMULATE_TIMEOUT_MS_DEFAULT;
  const chainIdDefault = config.chainId ?? 11_155_111;
  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    isEnabled: () => enabled,
    isStrict: () => strict,

    async simulatePrimaryLeg(input) {
      if (!enabled) {
        return skippedResult("DESK_KH_SIMULATE_PREFLIGHT disabled", false);
      }

      let built: BuiltPrimaryLegSimulate;
      try {
        built = buildPrimaryLegSimulateRequest(input, chainIdDefault);
      } catch (error) {
        const msg =
          error instanceof Error
            ? error.message
            : "Failed to build primary leg simulate request";
        const khSimulate: DeskAuditKhSimulate = {
          attempted: false,
          status: "skipped",
          errorMessage: msg,
        };
        // Build failure is not a chain revert — soft continues; strict still blocks
        // only on transport/revert (plan: transport fails). Skip is fail-open even in strict
        // when the shape is unsupported (honest: no sim attempted).
        return { khSimulate, shouldBlock: false };
      }

      assertSimulateTrueOnly(built.body);

      const url = `${baseUrl}${built.path}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
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

        const khSimulate = mapSimulateResponse(json, res.ok, built.endpoint);
        const wouldRevert = khSimulate.wouldRevert === true;
        const isError = khSimulate.status === "error";
        const shouldBlock =
          strict && (wouldRevert || isError || khSimulate.status === "failed");

        let blockReason: string | undefined;
        if (shouldBlock) {
          blockReason = wouldRevert
            ? "kh_simulate_would_revert"
            : "kh_simulate_error";
        }

        return {
          khSimulate,
          shouldBlock,
          ...(blockReason ? { blockReason } : {}),
          requestMeta: {
            endpoint: built.endpoint,
            path: built.path,
            label: built.label,
            simulate: true,
          },
        };
      } catch (error) {
        const aborted =
          error instanceof Error &&
          (error.name === "AbortError" || /aborted/i.test(error.message));
        const msg = aborted
          ? `KeeperHub dry-run timed out after ${timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : "KeeperHub dry-run transport error";
        const khSimulate: DeskAuditKhSimulate = {
          attempted: true,
          status: "error",
          endpoint: built.endpoint,
          errorMessage: msg,
        };
        return {
          khSimulate,
          shouldBlock: strict,
          ...(strict ? { blockReason: "kh_simulate_error" } : {}),
          requestMeta: {
            endpoint: built.endpoint,
            path: built.path,
            label: built.label,
            simulate: true,
          },
        };
      } finally {
        clearTimeout(timer);
      }
    },
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
