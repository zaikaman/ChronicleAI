/**
 * Oracle–AMM dislocation strategy: Chainlink vs Uniswap mid → capped fade swap.
 * No leverage. Direction: sell the rich leg (fade dislocation).
 */

import type { DeskPolicyConfig, DeskLeg, StrategyPlan } from "./types.ts";
import { DESK_BASIS_ABSURD_BPS } from "./oracle-amm-pricing.ts";

export interface OracleAmmInput {
  /** Oracle mid price (e.g. ETH/USD). */
  oraclePrice: number;
  /** AMM mid / quote price in same units. */
  ammPrice: number;
  oracleUpdatedAtMs?: number | null | undefined;
  freeUsdc: number;
  freeWeth: number;
  ethUsdForInventory?: number | null | undefined;
  maxTradeUsdc: number;
  nowMs?: number | undefined;
}

export interface OracleAmmStrategy {
  plan(input: OracleAmmInput): StrategyPlan;
  /**
   * basisBps = (amm - oracle) / oracle * 10000
   * Positive → AMM rich vs oracle (fade by selling WETH for USDC).
   * Negative → AMM cheap (fade by buying WETH with USDC).
   */
  computeBasisBps(oraclePrice: number, ammPrice: number): number;
}

function roundAmount(n: number, decimals = 6): string {
  const f = 10 ** decimals;
  return (Math.round(n * f) / f).toFixed(decimals);
}

export function computeOracleAmmBasisBps(oraclePrice: number, ammPrice: number): number {
  if (!Number.isFinite(oraclePrice) || oraclePrice <= 0) {
    throw new Error(`Invalid oracle price: ${oraclePrice}`);
  }
  if (!Number.isFinite(ammPrice) || ammPrice <= 0) {
    throw new Error(`Invalid AMM price: ${ammPrice}`);
  }
  return Math.round(((ammPrice - oraclePrice) / oraclePrice) * 10_000);
}

export function createOracleAmmStrategy(config: DeskPolicyConfig): OracleAmmStrategy {
  return {
    computeBasisBps: computeOracleAmmBasisBps,

    plan(input) {
      if (!Number.isFinite(input.oraclePrice) || input.oraclePrice <= 0) {
        return { action: "ignore", reasonCodes: ["oracle_price_invalid"] };
      }
      if (!Number.isFinite(input.ammPrice) || input.ammPrice <= 0) {
        return { action: "ignore", reasonCodes: ["amm_price_invalid"] };
      }

      const now = input.nowMs ?? Date.now();
      if (
        input.oracleUpdatedAtMs != null &&
        Number.isFinite(input.oracleUpdatedAtMs) &&
        now - input.oracleUpdatedAtMs > config.oracleMaxStalenessMs
      ) {
        return { action: "ignore", reasonCodes: ["oracle_stale"] };
      }

      let basisBps: number;
      try {
        basisBps = computeOracleAmmBasisBps(input.oraclePrice, input.ammPrice);
      } catch {
        return { action: "ignore", reasonCodes: ["basis_compute_failed"] };
      }

      // Mis-scaled oracle/AMM (e.g. raw Chainlink answer treated as human) or
      // thin-testnet pools with multi-x marks produce absurd "edges". Never trade those.
      if (!config.trustTestnetSignals && Math.abs(basisBps) > DESK_BASIS_ABSURD_BPS) {
        return {
          action: "ignore",
          reasonCodes: [
            "basis_data_quality",
            `basis_bps=${basisBps}`,
            `oracle=${input.oraclePrice}`,
            `amm=${input.ammPrice}`,
          ],
        };
      }

      if (Math.abs(basisBps) < config.basisBps) {
        return {
          action: "ignore",
          reasonCodes: [
            "basis_below_threshold",
            `basis_bps=${basisBps}`,
            `need_bps>=${config.basisBps}`,
          ],
        };
      }

      const maxNotional = Math.min(input.maxTradeUsdc, config.maxTradeUsdc);
      const legs: DeskLeg[] = [];
      let notional = 0;
      let direction: "sell_weth" | "buy_weth";

      if (basisBps > 0) {
        // AMM rich: sell WETH → USDC
        direction = "sell_weth";
        const ethUsd =
          input.ethUsdForInventory != null && input.ethUsdForInventory > 0
            ? input.ethUsdForInventory
            : input.oraclePrice;
        const wethUsd = Math.max(0, input.freeWeth) * ethUsd;
        notional = Math.min(maxNotional, wethUsd);
        if (notional <= 0) {
          return {
            action: "ignore",
            reasonCodes: ["insufficient_weth_inventory", `basis_bps=${basisBps}`],
          };
        }
        const wethIn = notional / ethUsd;
        legs.push({
          protocol: "uniswap",
          action: "swap-exact-input",
          tokenIn: "WETH",
          tokenOut: "USDC",
          amountIn: roundAmount(wethIn, 8),
          note: "fade_amm_rich_sell_weth",
        });
      } else {
        // AMM cheap: buy WETH with USDC
        direction = "buy_weth";
        notional = Math.min(maxNotional, Math.max(0, input.freeUsdc));
        if (notional <= 0) {
          return {
            action: "ignore",
            reasonCodes: ["insufficient_usdc_inventory", `basis_bps=${basisBps}`],
          };
        }
        legs.push({
          protocol: "uniswap",
          action: "swap-exact-input",
          tokenIn: "USDC",
          tokenOut: "WETH",
          amountIn: roundAmount(notional, 6),
          note: "fade_amm_cheap_buy_weth",
        });
      }

      return {
        action: "propose",
        strategy: "oracle_amm",
        notionalUsdc: Math.round(notional * 1e6) / 1e6,
        legs,
        reasonCodes: [
          "oracle_amm",
          direction,
          `basis_bps=${basisBps}`,
          `oracle=${input.oraclePrice}`,
          `amm=${input.ammPrice}`,
        ],
        riskIncreasing: true,
        severity: Math.min(95, 50 + Math.floor(Math.abs(basisBps) / 2)),
        policyVerdict: "trade",
      };
    },
  };
}
