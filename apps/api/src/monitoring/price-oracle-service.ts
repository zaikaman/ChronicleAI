// On-chain price oracle via Chainlink aggregators (ETH/USD, LINK/USD)
//
// Hardening for flaky testnet RPCs:
// - Shared public client with static chain + request timeout
// - Fresh cache + stale fallback so bursty traffic doesn't spam RPC
// - Single-RPC constraint: never eth_call foreign-chain aggregator addresses
//   (they have no code on the RPC chain → empty 0x / "empty decimals" noise)
// - ETH/LINK USD is global — serve the RPC-native feed for any requested chainId
// - Chainlink USD feeds always use 8 decimals (skip flaky decimals() call)
// - Single retry on empty/bad latestRoundData (common flaky RPC pattern)

import {
  CHAIN_ID_SEPOLIA,
  CHAINLINK_ETH_USD,
  CHAINLINK_LINK_USD,
} from "@chronicleai/config";
import {
  type Address,
  type Hex,
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  http,
  parseAbi,
} from "viem";
import { chainFromId } from "../lib/viem-chain.ts";

const AGGREGATOR_ABI = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

/**
 * Chainlink ETH/USD and LINK/USD aggregators always return 8-decimal answers.
 * Calling decimals() on a wrong-chain address yields empty 0x and noisy retries;
 * hardcoding avoids that round-trip for these known USD feeds.
 */
const CHAINLINK_USD_DECIMALS = 8;

export interface PriceOracle {
  /** USD price of 1 ETH. Returns null when unavailable. */
  getEthUsdPrice(chainId: number): Promise<number | null>;
  /** USD price of 1 LINK. Returns null when unavailable. */
  getLinkUsdPrice(chainId: number): Promise<number | null>;
}

/** Low-level eth_call used by the oracle (injectable for tests). */
export type PriceOracleEthCall = (to: string, data: string) => Promise<string>;

export interface PriceOracleOptions {
  /**
   * Chain the RPC_URL actually points at (default: Ethereum Sepolia).
   * Used when a requested chain feed is not readable on this RPC.
   */
  rpcChainId?: number;
  /** Per-RPC call timeout in ms (default 6s). */
  timeoutMs?: number;
  /** Fresh cache TTL (default 60s). */
  cacheTtlMs?: number;
  /** Serve last good price for this long after TTL (default 30m). */
  staleTtlMs?: number;
  /**
   * Optional eth_call override (tests). When set, RPC_URL is unused for reads.
   */
  ethCall?: PriceOracleEthCall;
}

type FeedCache = {
  price: number;
  /** Fresh until this time — prefer live refresh after. */
  freshUntil: number;
  /** Absolute last-usable time for soft fallback. */
  staleUntil: number;
};

const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_STALE_TTL_MS = 30 * 60_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`PriceOracle timeout after ${timeoutMs}ms (${label})`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function createRpcEthCall(
  rpcUrl: string,
  rpcChainId: number,
  timeoutMs: number,
): PriceOracleEthCall {
  const client = createPublicClient({
    chain: chainFromId(rpcChainId),
    transport: http(rpcUrl, { timeout: timeoutMs, batch: false }),
  });

  return async (to, data) => {
    const result = await withTimeout(
      client.call({
        to: to as Address,
        data: data as Hex,
      }),
      timeoutMs,
      `eth_call ${to.slice(0, 10)}`,
    );
    return (result.data ?? "0x") as string;
  };
}

/**
 * Creates a Chainlink-backed price oracle. Caches successful reads and falls
 * back to stale values / RPC-native feeds so event ingest never blocks for
 * minutes on flaky testnet RPCs.
 */
export function createPriceOracle(
  rpcUrl: string | undefined,
  options?: PriceOracleOptions,
): PriceOracle {
  const rpcChainId = options?.rpcChainId ?? CHAIN_ID_SEPOLIA;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cacheTtlMs = options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const staleTtlMs = options?.staleTtlMs ?? DEFAULT_STALE_TTL_MS;

  const ethCache = new Map<number, FeedCache>();
  const linkCache = new Map<number, FeedCache>();

  let ethCall: PriceOracleEthCall | null = options?.ethCall ?? null;
  if (!ethCall && rpcUrl?.trim()) {
    ethCall = createRpcEthCall(rpcUrl.trim(), rpcChainId, timeoutMs);
  }

  function getCached(
    cache: Map<number, FeedCache>,
    chainId: number,
  ): { price: number; fresh: boolean } | null {
    const hit = cache.get(chainId);
    if (!hit) return null;
    const now = Date.now();
    if (now <= hit.freshUntil) return { price: hit.price, fresh: true };
    if (now <= hit.staleUntil) return { price: hit.price, fresh: false };
    return null;
  }

  function putCache(
    cache: Map<number, FeedCache>,
    chainIds: number[],
    price: number,
  ): void {
    const now = Date.now();
    const entry: FeedCache = {
      price,
      freshUntil: now + cacheTtlMs,
      staleUntil: now + staleTtlMs,
    };
    for (const id of chainIds) {
      cache.set(id, entry);
    }
  }

  async function readAggregatorOnce(
    feed: string,
    label: string,
  ): Promise<number | null> {
    if (!ethCall) return null;

    const roundData = encodeFunctionData({
      abi: AGGREGATOR_ABI,
      functionName: "latestRoundData",
    });
    const roundRaw = await ethCall(feed, roundData);
    if (!roundRaw || roundRaw === "0x") {
      throw new Error(`empty latestRoundData result for ${label}`);
    }
    const decoded = decodeFunctionResult({
      abi: AGGREGATOR_ABI,
      functionName: "latestRoundData",
      data: roundRaw as Hex,
    });
    const answer = decoded[1] as bigint;
    if (answer <= 0n) return null;
    const price = Number(answer) / 10 ** CHAINLINK_USD_DECIMALS;
    if (!Number.isFinite(price) || price <= 0) return null;
    return price;
  }

  async function readAggregator(
    feed: string,
    label: string,
  ): Promise<number | null> {
    try {
      return await readAggregatorOnce(feed, label);
    } catch (firstError) {
      try {
        return await readAggregatorOnce(feed, label);
      } catch (secondError) {
        const msg =
          secondError instanceof Error
            ? secondError.message
            : firstError instanceof Error
              ? firstError.message
              : String(secondError);
        console.warn(`[PriceOracle] Failed to read Chainlink ${label}: ${msg}`);
        return null;
      }
    }
  }

  /**
   * Resolve which aggregator address to eth_call.
   *
   * A single JSON-RPC endpoint can only see contracts on its own chain.
   * Mainnet feed addresses eth_call'd on Sepolia return empty 0x (no code) —
   * that produced the noisy `empty decimals result for ETH/USD@1` logs.
   * ETH/USD and LINK/USD are global, so the RPC-native feed is always correct.
   */
  function resolveReadableFeed(
    chainId: number,
    feedByChain: Readonly<Record<number, string>>,
  ): { feed: string; viaChainId: number } | null {
    const rpcFeed = feedByChain[rpcChainId];
    if (rpcFeed) {
      return { feed: rpcFeed, viaChainId: rpcChainId };
    }
    // No feed registered for the RPC chain — last resort primary (may fail).
    const primary = feedByChain[chainId];
    if (primary) {
      return { feed: primary, viaChainId: chainId };
    }
    return null;
  }

  async function readFeed(
    chainId: number,
    feedByChain: Readonly<Record<number, string>>,
    cache: Map<number, FeedCache>,
    label: string,
  ): Promise<number | null> {
    const cached = getCached(cache, chainId);
    if (cached?.fresh) return cached.price;

    if (!ethCall) {
      return cached?.price ?? null;
    }

    const attempt = resolveReadableFeed(chainId, feedByChain);
    if (!attempt) {
      return cached?.price ?? null;
    }

    const price = await readAggregator(
      attempt.feed,
      `${label}@${attempt.viaChainId}`,
    );
    if (price != null) {
      // Cache under both the requested and RPC chain so cross-chain event
      // normalization reuses one successful Sepolia (or mainnet) read.
      putCache(cache, [chainId, attempt.viaChainId], price);
      return price;
    }

    if (cached) {
      return cached.price;
    }
    const rpcStale = getCached(cache, rpcChainId);
    return rpcStale?.price ?? null;
  }

  return {
    getEthUsdPrice(chainId) {
      return readFeed(chainId, CHAINLINK_ETH_USD, ethCache, "ETH/USD");
    },
    getLinkUsdPrice(chainId) {
      return readFeed(chainId, CHAINLINK_LINK_USD, linkCache, "LINK/USD");
    },
  };
}
