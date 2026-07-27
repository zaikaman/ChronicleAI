// On-chain price oracle via Chainlink ETH/USD aggregators

import { CHAINLINK_ETH_USD } from "@chronicleai/config";
import { ethers } from "ethers";

const AGGREGATOR_ABI = [
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
] as const;

export interface PriceOracle {
  /** USD price of 1 ETH. Returns null when unavailable. */
  getEthUsdPrice(chainId: number): Promise<number | null>;
}

/**
 * Creates a Chainlink-backed price oracle. Caches the last successful ETH/USD
 * read for a short TTL to avoid spamming RPC on bursty event volume.
 */
export function createPriceOracle(rpcUrl: string | undefined): PriceOracle {
  let cached: { price: number; expiresAt: number } | null = null;
  const CACHE_TTL_MS = 60_000;

  return {
    async getEthUsdPrice(chainId: number): Promise<number | null> {
      if (cached && cached.expiresAt > Date.now()) {
        return cached.price;
      }

      if (!rpcUrl) return null;

      const feed = CHAINLINK_ETH_USD[chainId];
      if (!feed) return null;

      try {
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const aggregator = new ethers.Contract(feed, AGGREGATOR_ABI, provider);
        const latestRoundData = aggregator.getFunction("latestRoundData");
        const decimalsFn = aggregator.getFunction("decimals");
        const round = (await latestRoundData()) as [bigint, bigint, bigint, bigint, bigint];
        const answer = round[1];
        const decimals = Number(await decimalsFn());
        if (answer <= 0n) return null;
        const price = Number(answer) / 10 ** decimals;
        if (!Number.isFinite(price) || price <= 0) return null;
        cached = { price, expiresAt: Date.now() + CACHE_TTL_MS };
        return price;
      } catch (error) {
        console.warn(
          "[PriceOracle] Failed to read Chainlink ETH/USD:",
          error instanceof Error ? error.message : error,
        );
        return cached?.price ?? null;
      }
    },
  };
}
