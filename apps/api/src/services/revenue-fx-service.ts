// Live revenue FX: convert settled currency units (USDC-ish / USD) → native ETH
// for treasury transfer amounts. Prefers Chainlink ETH/USD; optional static fallback.

import type { PriceOracle } from "../monitoring/price-oracle-service.ts";

export type RevenueFxMode = "oracle" | "static" | "auto";

export type RevenueFxSource = "chainlink" | "static_fallback" | "static";

export interface RevenueFxQuote {
  /** ETH received per 1 currency unit (e.g. 1 USDC). */
  ethPerCurrencyUnit: number;
  /** Spot ETH/USD when source is chainlink; null for pure static. */
  ethUsdPrice: number | null;
  source: RevenueFxSource;
}

export interface RevenueFxService {
  /**
   * Resolve ETH-per-currency-unit for payout transfers.
   * Throws when no usable rate is available (caller should skip routing).
   */
  getEthPerCurrencyUnit(): Promise<RevenueFxQuote>;
}

export interface RevenueFxServiceConfig {
  priceOracle: PriceOracle;
  /** Chain id for Chainlink feed selection (e.g. 11155111 Ethereum Sepolia, 1 mainnet). */
  chainId: number;
  /**
   * oracle  — require live Chainlink (fail if unavailable)
   * static  — use staticEthPerCurrencyUnit only
   * auto    — prefer Chainlink; fall back to static when configured
   */
  mode: RevenueFxMode;
  /** Static ETH per currency unit (demo/tests or oracle fallback). */
  staticEthPerCurrencyUnit?: number | undefined;
}

/**
 * Convert a USD-ish currency amount to ETH using ETH/USD spot.
 * amountCurrency / ethUsdPrice = eth.
 */
export function ethPerCurrencyFromEthUsd(ethUsdPrice: number): number {
  if (!(ethUsdPrice > 0) || !Number.isFinite(ethUsdPrice)) {
    throw new Error(`Invalid ETH/USD price: ${ethUsdPrice}`);
  }
  return 1 / ethUsdPrice;
}

export function createRevenueFxService(config: RevenueFxServiceConfig): RevenueFxService {
  const { priceOracle, chainId, mode } = config;
  const staticRate = config.staticEthPerCurrencyUnit;

  function requireStatic(source: RevenueFxSource): RevenueFxQuote {
    if (!(typeof staticRate === "number") || !(staticRate > 0) || !Number.isFinite(staticRate)) {
      throw new Error(
        "Revenue FX requires REVENUE_ETH_PER_CURRENCY_UNIT > 0 when using static FX or as oracle fallback",
      );
    }
    return {
      ethPerCurrencyUnit: staticRate,
      ethUsdPrice: null,
      source,
    };
  }

  return {
    async getEthPerCurrencyUnit(): Promise<RevenueFxQuote> {
      if (mode === "static") {
        return requireStatic("static");
      }

      const ethUsd = await priceOracle.getEthUsdPrice(chainId);
      if (ethUsd != null && ethUsd > 0 && Number.isFinite(ethUsd)) {
        return {
          ethPerCurrencyUnit: ethPerCurrencyFromEthUsd(ethUsd),
          ethUsdPrice: ethUsd,
          source: "chainlink",
        };
      }

      if (mode === "oracle") {
        throw new Error(
          `Chainlink ETH/USD unavailable for chainId=${chainId} (RPC_URL / feed). Set REVENUE_FX_MODE=auto with REVENUE_ETH_PER_CURRENCY_UNIT fallback, or fix RPC.`,
        );
      }

      // auto → static fallback
      return requireStatic("static_fallback");
    },
  };
}

/** Test helper: fixed quote without RPC. */
export function createStaticRevenueFxService(ethPerCurrencyUnit: number): RevenueFxService {
  if (!(ethPerCurrencyUnit > 0) || !Number.isFinite(ethPerCurrencyUnit)) {
    throw new Error("static RevenueFxService requires ethPerCurrencyUnit > 0");
  }
  return {
    async getEthPerCurrencyUnit() {
      return {
        ethPerCurrencyUnit,
        ethUsdPrice: null,
        source: "static" as const,
      };
    },
  };
}
