/**
 * Startup / ops check: does KeeperHub report private mempool capability on Sepolia?
 *
 * Phase 4 — when Chronicle policy prefers private routing but KH chain config
 * lacks usePrivateMempoolRpc, demos would claim private while submitting publicly.
 * Log a clear warning; never invent success.
 */

import {
  PRIVATE_ROUTING_CHAIN_ID,
  PRIVATE_ROUTING_PRODUCT_DESCRIPTION,
} from "./routing-metadata.ts";

export interface KeeperHubChainRow {
  chainId?: number;
  id?: string;
  name?: string;
  usePrivateMempoolRpc?: boolean;
  isEnabled?: boolean;
}

export interface PrivateMempoolCapabilityResult {
  ok: true;
  chainId: number;
  usePrivateMempoolRpc: boolean;
  chainName: string | null;
  /** True when private policy is on and KH reports capability for the chain. */
  privateRoutingCapable: boolean;
}

export interface PrivateMempoolCapabilityError {
  ok: false;
  chainId: number;
  reason: string;
}

export type PrivateMempoolCapabilityCheck =
  | PrivateMempoolCapabilityResult
  | PrivateMempoolCapabilityError;

export interface FetchPrivateMempoolCapabilityParams {
  apiBaseUrl: string;
  /** Optional — chains listing is public on KH; still sent when present. */
  apiKey?: string | undefined;
  chainId?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
  timeoutMs?: number | undefined;
}

function normalizeBaseUrl(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/+$/, "");
}

/**
 * GET {KEEPERHUB_API_BASE_URL}/api/chains and read usePrivateMempoolRpc for chainId.
 */
export async function fetchKeeperHubPrivateMempoolCapability(
  params: FetchPrivateMempoolCapabilityParams,
): Promise<PrivateMempoolCapabilityCheck> {
  const chainId = params.chainId ?? PRIVATE_ROUTING_CHAIN_ID;
  const timeoutMs =
    typeof params.timeoutMs === "number" && params.timeoutMs > 0
      ? params.timeoutMs
      : 8_000;
  const fetchImpl = params.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return {
      ok: false,
      chainId,
      reason: "fetch is not available in this runtime",
    };
  }

  const base = normalizeBaseUrl(params.apiBaseUrl);
  if (!base) {
    return { ok: false, chainId, reason: "empty KeeperHub API base URL" };
  }

  const url = `${base}/api/chains`;
  const headers = new Headers({ Accept: "application/json" });
  const key = params.apiKey?.trim();
  if (key) {
    headers.set("Authorization", `Bearer ${key}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      return {
        ok: false,
        chainId,
        reason: `KeeperHub GET /api/chains returned HTTP ${res.status}`,
      };
    }

    const body: unknown = await res.json();
    const rows: KeeperHubChainRow[] = Array.isArray(body)
      ? (body as KeeperHubChainRow[])
      : Array.isArray((body as { chains?: unknown })?.chains)
        ? ((body as { chains: KeeperHubChainRow[] }).chains)
        : [];

    const match = rows.find(
      (row) =>
        typeof row.chainId === "number" &&
        Number.isFinite(row.chainId) &&
        row.chainId === chainId,
    );

    if (!match) {
      return {
        ok: false,
        chainId,
        reason: `KeeperHub chains list has no chainId ${chainId}`,
      };
    }

    const usePrivateMempoolRpc = match.usePrivateMempoolRpc === true;
    return {
      ok: true,
      chainId,
      usePrivateMempoolRpc,
      chainName: typeof match.name === "string" ? match.name : null,
      privateRoutingCapable: usePrivateMempoolRpc,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === "AbortError"
          ? `KeeperHub chains capability check timed out after ${timeoutMs}ms`
          : error.message
        : String(error);
    return { ok: false, chainId, reason: message };
  } finally {
    clearTimeout(timer);
  }
}

export interface WarnPrivateRoutingMisconfiguredParams {
  apiBaseUrl?: string | undefined;
  apiKey?: string | undefined;
  /** True when desk and/or registry private policy is on. */
  privatePolicyEnabled: boolean;
  chainId?: number | undefined;
  logWarn?: ((message: string) => void) | undefined;
  logInfo?: ((message: string) => void) | undefined;
  fetchImpl?: typeof fetch | undefined;
}

/**
 * Fire-and-forget friendly boot check. Never throws.
 * When private policy is on and KH is configured, verify Sepolia capability.
 */
export async function warnIfPrivateRoutingMisconfigured(
  params: WarnPrivateRoutingMisconfiguredParams,
): Promise<PrivateMempoolCapabilityCheck | null> {
  const logWarn = params.logWarn ?? ((m: string) => console.warn(m));
  const logInfo = params.logInfo ?? ((m: string) => console.info(m));
  const chainId = params.chainId ?? PRIVATE_ROUTING_CHAIN_ID;

  if (!params.privatePolicyEnabled) {
    return null;
  }

  const base = params.apiBaseUrl?.trim();
  if (!base) {
    logWarn(
      `[private-routing] DESK/REGISTRY private mempool policy is ON but KEEPERHUB_API_BASE_URL is unset — cannot verify chain capability. ${PRIVATE_ROUTING_PRODUCT_DESCRIPTION} Configure KeeperHub CHAIN_RPC_CONFIG for Sepolia (usePrivateMempoolRpc + Flashbots Protect RPC).`,
    );
    return {
      ok: false,
      chainId,
      reason: "KEEPERHUB_API_BASE_URL unset",
    };
  }

  const result = await fetchKeeperHubPrivateMempoolCapability({
    apiBaseUrl: base,
    apiKey: params.apiKey,
    chainId,
    fetchImpl: params.fetchImpl,
  });

  if (!result.ok) {
    logWarn(
      `[private-routing] Could not verify KeeperHub private mempool capability for chain ${chainId}: ${result.reason}. Demos must not claim private routing is applied until CHAIN_RPC_CONFIG enables usePrivateMempoolRpc on Sepolia with Flashbots Protect + custom read RPC (https://rpc-sepolia.flashbots.net/?url=<fast public Sepolia RPC>).`,
    );
    return result;
  }

  if (!result.usePrivateMempoolRpc) {
    logWarn(
      `[private-routing] Policy requests private mempool but KeeperHub chain ${chainId}${
        result.chainName ? ` (${result.chainName})` : ""
      } has usePrivateMempoolRpc=false. Writes will fall back to the public mempool. Set CHAIN_RPC_CONFIG eth-sepolia isPrivateMempoolRpcEnabled=true and privateMempoolRpcUrl=https://rpc-sepolia.flashbots.net/?url=<fast public Sepolia RPC> (custom read RPC — bare Protect often times out on approve/Uniswap multi-call paths) then re-check GET /api/chains.`,
    );
    return result;
  }

  logInfo(
    `[private-routing] KeeperHub chain ${chainId}${
      result.chainName ? ` (${result.chainName})` : ""
    } reports usePrivateMempoolRpc=true. ${PRIVATE_ROUTING_PRODUCT_DESCRIPTION}`,
  );
  return result;
}
