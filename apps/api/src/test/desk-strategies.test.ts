import { describe, expect, it } from "vitest";
import { createRiskDefendStrategy, sizeDefendRepayUsdc } from "../desk/strategy-risk.ts";
import { createYieldRotationStrategy } from "../desk/strategy-rotation.ts";
import {
  computeOracleAmmBasisBps,
  createOracleAmmStrategy,
} from "../desk/strategy-oracle-amm.ts";
import type { DeskPolicyConfig } from "../desk/types.ts";

const config: DeskPolicyConfig = {
  targetAumUsdc: 50,
  maxAumUsdc: 80,
  minAumUsdc: 20,
  topupChunkUsdc: 10,
  minFreeUsdc: 10,
  inventoryTopupUsdc: 10,
  preferUnwindForFreeUsdc: true,
  profitSweepUsdc: 15,
  topupCooldownMs: 3_600_000,
  postMaintenanceSweepCooldownMs: 1_200_000,
  hfWarn: 1.5,
  hfCritical: 1.2,
  basisBps: 50,
  apyDeltaBps: 50,
  maxTradeUsdc: 15,
  killHeartbeatMs: 6 * 60 * 60_000,
  failedRunCooldownMs: 15 * 60_000,
  oracleMaxStalenessMs: 60 * 60_000,
  apyConsecutivePolls: 2,
  apyAbsurdBps: 5000,
  rebalanceIntervalMs: 21600000,
  maintenanceNotionalUsdc: 10,
  eventMicrotradeEnabled: false,
  eventMicrotradeUsdc: 5,
  eventMicrotradeCooldownMs: 3_600_000,
  eventMicrotradeLookbackMs: 3_600_000,
  gasElevatedGwei: 50,
  paused: false,
};

describe("strategy-risk", () => {
  const strategy = createRiskDefendStrategy(config);

  it("ignores healthy HF", () => {
    const plan = strategy.plan({
      healthFactor: 2.5,
      totalCollateralUsd: 100,
      totalDebtUsd: 40,
      freeUsdc: 20,
      maxTradeUsdc: 15,
    });
    expect(plan.action).toBe("ignore");
  });

  it("proposes repay on HF warn", () => {
    const plan = strategy.plan({
      healthFactor: 1.35,
      totalCollateralUsd: 100,
      totalDebtUsd: 50,
      freeUsdc: 20,
      maxTradeUsdc: 15,
    });
    expect(plan.action).toBe("propose");
    if (plan.action === "propose") {
      expect(plan.strategy).toBe("risk_defend");
      expect(plan.riskIncreasing).toBe(false);
      expect(plan.legs.some((l) => l.action === "repay")).toBe(true);
    }
  });

  it("sizes defend repay conservatively", () => {
    const amount = sizeDefendRepayUsdc({
      healthFactor: 1.1,
      totalDebtUsd: 40,
      freeUsdc: 30,
      freeLinkUsd: 0,
      maxTradeUsdc: 15,
      hfCritical: 1.2,
      hfWarn: 1.5,
    });
    // critical → 50% of debt = 20, capped by maxTrade 15
    expect(amount).toBe(15);
  });
});

describe("strategy-rotation", () => {
  const strategy = createYieldRotationStrategy(config);

  it("requires consecutive edge polls", () => {
    const plan = strategy.plan({
      idleUsdcApyBps: 0,
      aaveSupplyApyBps: 200,
      consecutiveEdgePolls: 1,
      freeUsdc: 40,
      maxTradeUsdc: 15,
    });
    expect(plan.action).toBe("ignore");
  });

  it("executes an absurd APY edge as a rotate-in thesis", () => {
    // Testnet edges are trusted: the deterministic engine proposes rotate-in
    // even above the data-quality ceiling (no absurd gate).
    const plan = strategy.plan({
      idleUsdcApyBps: 0,
      aaveSupplyApyBps: 22_700,
      consecutiveEdgePolls: 10,
      freeUsdc: 40,
      maxTradeUsdc: 15,
    });
    expect(plan.action).toBe("propose");
    if (plan.action === "propose") {
      expect(plan.strategy).toBe("yield_rotation");
      expect(plan.riskIncreasing).toBe(true);
      expect(plan.reasonCodes).toContain("into_aave_link");
      expect(plan.reasonCodes).toContain("edge_bps=22700");
    }
  });

  it("plans USDC→LINK→Aave when edge holds", () => {
    const plan = strategy.plan({
      idleUsdcApyBps: 0,
      aaveSupplyApyBps: 200,
      consecutiveEdgePolls: 2,
      freeUsdc: 40,
      maxTradeUsdc: 15,
    });
    expect(plan.action).toBe("propose");
    if (plan.action === "propose") {
      expect(plan.strategy).toBe("yield_rotation");
      expect(plan.legs[0]?.protocol).toBe("uniswap");
      expect(plan.legs[1]?.protocol).toBe("aave-v3");
      expect(plan.notionalUsdc).toBe(15);
    }
  });

  it("computes apy delta bps", () => {
    expect(strategy.apyDeltaBps(0, 75)).toBe(75);
  });

  it("plans free-powder maintenance when free USDC is short (no edge claim)", () => {
    const plan = strategy.plan({
      idleUsdcApyBps: 0,
      aaveSupplyApyBps: 22_700,
      consecutiveEdgePolls: 0,
      freeUsdc: 0,
      aaveLinkSupplied: 50,
      linkUsdPrice: 12,
      maxTradeUsdc: 15,
      nowMs: 1_000_000,
      lastMaintenanceAtMs: null,
    });
    expect(plan.action).toBe("propose");
    if (plan.action === "propose") {
      expect(plan.strategy).toBe("yield_rotation");
      expect(plan.riskIncreasing).toBe(false);
      expect(plan.reasonCodes).toContain("free_usdc_shortfall");
      expect(plan.reasonCodes.some((c) => c.startsWith("edge_bps="))).toBe(false);
      expect(plan.legs[0]?.action).toBe("withdraw");
      expect(plan.legs[1]?.tokenOut).toBe("USDC");
      expect(plan.notionalUsdc).toBeGreaterThan(0);
      expect(plan.notionalUsdc).toBeLessThanOrEqual(10);
    }
  });

  it("still applies the consecutive-poll gate to absurd APY edges", () => {
    const plan = strategy.plan({
      idleUsdcApyBps: 0,
      aaveSupplyApyBps: 22_700,
      consecutiveEdgePolls: 1, // below the required 2
      freeUsdc: 40,
      maxTradeUsdc: 15,
    });
    expect(plan.action).toBe("ignore");
    if (plan.action === "ignore") {
      expect(plan.reasonCodes).toContain("apy_edge_not_consecutive");
    }
  });

  it("proposes absurd APY rotate-in without freeable Aave inventory", () => {
    // Rotate-in only needs free USDC — no absurd gate blocks the thesis.
    const plan = strategy.plan({
      idleUsdcApyBps: 0,
      aaveSupplyApyBps: 22_700,
      consecutiveEdgePolls: 5,
      freeUsdc: 40,
      aaveLinkSupplied: 0,
      maxTradeUsdc: 15,
    });
    expect(plan.action).toBe("propose");
    if (plan.action === "propose") {
      expect(plan.reasonCodes).toContain("into_aave_link");
      expect(plan.riskIncreasing).toBe(true);
    }
  });

  it("respects rebalance interval for non-shortfall maintenance", () => {
    const now = 10_000_000;
    const plan = strategy.plan({
      idleUsdcApyBps: 0,
      aaveSupplyApyBps: 80,
      consecutiveEdgePolls: 0,
      freeUsdc: 5,
      aaveLinkSupplied: 20,
      linkUsdPrice: 10,
      maxTradeUsdc: 15,
      nowMs: now,
      // Free is below minFree (10) → shortfall path, not interval-gated.
      lastMaintenanceAtMs: now - 1_000,
    });
    // free_usdc_shortfall is not interval-gated
    expect(plan.action).toBe("propose");
    if (plan.action === "propose") {
      expect(plan.reasonCodes).toContain("free_usdc_shortfall");
    }

    // Above min free, one-sided, interval not due → ignore (no yield edge either)
    const blocked = strategy.plan({
      idleUsdcApyBps: 0,
      aaveSupplyApyBps: 80,
      consecutiveEdgePolls: 0,
      freeUsdc: 12,
      aaveLinkSupplied: 20,
      linkUsdPrice: 10,
      maxTradeUsdc: 15,
      nowMs: now,
      lastMaintenanceAtMs: now - 1_000,
    });
    expect(blocked.action).toBe("ignore");
  });

  it("plans cadence maintenance_rebalance when free USDC is at floor but book is one-sided", () => {
    const now = 10_000_000;
    const plan = strategy.plan({
      idleUsdcApyBps: 0,
      aaveSupplyApyBps: 80, // honest edge, below absurd
      consecutiveEdgePolls: 0,
      freeUsdc: 12, // at/above minFree (10)
      aaveLinkSupplied: 40, // $400 freeable @ $10 → one-sided vs free 12
      linkUsdPrice: 10,
      maxTradeUsdc: 15,
      nowMs: now,
      lastMaintenanceAtMs: now - config.rebalanceIntervalMs - 1,
    });
    expect(plan.action).toBe("propose");
    if (plan.action === "propose") {
      expect(plan.reasonCodes).toContain("maintenance_rebalance");
      expect(plan.reasonCodes.some((c) => c.startsWith("edge_bps="))).toBe(false);
      expect(plan.riskIncreasing).toBe(false);
      expect(plan.legs[0]?.action).toBe("withdraw");
      expect(plan.notionalUsdc).toBeLessThanOrEqual(config.maintenanceNotionalUsdc);
    }
  });

  it("plans maintenance_rebalance when free is not short and book is one-sided", () => {
    const now = 10_000_000;
    const plan = strategy.plan({
      idleUsdcApyBps: 0,
      aaveSupplyApyBps: 80, // honest edge, below absurd
      consecutiveEdgePolls: 0, // cadence gate blocks rotate-in thesis
      freeUsdc: 15,
      aaveLinkSupplied: 50,
      linkUsdPrice: 12,
      maxTradeUsdc: 15,
      nowMs: now,
      lastMaintenanceAtMs: now - config.rebalanceIntervalMs - 1,
    });
    // One-sided Aave book (600 freeable vs 15 free) + interval due → cadence
    // maintenance (no yield thesis claim without consecutive edge).
    expect(plan.action).toBe("propose");
    if (plan.action === "propose") {
      expect(plan.reasonCodes).toContain("maintenance_rebalance");
      expect(plan.reasonCodes.some((c) => c.startsWith("edge_bps="))).toBe(false);
      expect(plan.riskIncreasing).toBe(false);
    }
  });

  it("does not cadence-maintain when free USDC already dominates freeable Aave", () => {
    const now = 10_000_000;
    const plan = strategy.plan({
      idleUsdcApyBps: 0,
      aaveSupplyApyBps: 80,
      consecutiveEdgePolls: 0,
      freeUsdc: 50,
      aaveLinkSupplied: 1, // $10 freeable < free 50 → not one-sided
      linkUsdPrice: 10,
      maxTradeUsdc: 15,
      nowMs: now,
      lastMaintenanceAtMs: null,
    });
    expect(plan.action).toBe("ignore");
  });

  it("estimates aave LINK from collateral USD when supplied amount missing", () => {
    const plan = strategy.plan({
      idleUsdcApyBps: 0,
      aaveSupplyApyBps: 100,
      consecutiveEdgePolls: 0,
      freeUsdc: 0,
      totalCollateralUsd: 600,
      totalDebtUsd: 0,
      linkUsdPrice: 12,
      maxTradeUsdc: 15,
    });
    expect(plan.action).toBe("propose");
    if (plan.action === "propose") {
      expect(plan.reasonCodes).toContain("free_usdc_shortfall");
    }
  });

  it("plans free-wallet LINK→USDC shortfall when Aave is empty", () => {
    const plan = strategy.plan({
      idleUsdcApyBps: 0,
      aaveSupplyApyBps: 22_700,
      consecutiveEdgePolls: 0,
      freeUsdc: 6.12,
      aaveLinkSupplied: 0,
      freeLink: 67.5,
      linkUsdPrice: 8.4,
      maxTradeUsdc: 15,
      nowMs: 1_000_000,
      lastMaintenanceAtMs: null,
    });
    expect(plan.action).toBe("propose");
    if (plan.action === "propose") {
      expect(plan.reasonCodes).toContain("free_usdc_shortfall");
      expect(plan.reasonCodes).toContain("out_of_free_link");
      expect(plan.reasonCodes).not.toContain("out_of_aave_link");
      expect(plan.riskIncreasing).toBe(false);
      expect(plan.legs).toHaveLength(1);
      expect(plan.legs[0]?.action).toBe("swap-exact-input");
      expect(plan.legs[0]?.tokenIn).toBe("LINK");
      expect(plan.legs[0]?.tokenOut).toBe("USDC");
      expect(plan.legs[0]?.note).toBe("rotate_free_link_to_usdc");
      expect(plan.notionalUsdc).toBeGreaterThan(0);
      expect(plan.notionalUsdc).toBeLessThanOrEqual(10);
    }
  });

  it("prefers Aave free-powder over free LINK when both freeable", () => {
    const plan = strategy.plan({
      idleUsdcApyBps: 0,
      aaveSupplyApyBps: 100,
      consecutiveEdgePolls: 0,
      freeUsdc: 0,
      aaveLinkSupplied: 5,
      freeLink: 50,
      linkUsdPrice: 10,
      maxTradeUsdc: 15,
    });
    expect(plan.action).toBe("propose");
    if (plan.action === "propose") {
      expect(plan.reasonCodes).toContain("out_of_aave_link");
      expect(plan.legs[0]?.action).toBe("withdraw");
    }
  });
});

describe("strategy-oracle-amm", () => {
  const strategy = createOracleAmmStrategy(config);

  it("computes basis bps", () => {
    // AMM 1% rich
    expect(computeOracleAmmBasisBps(3000, 3030)).toBe(100);
  });

  it("ignores basis below threshold", () => {
    const plan = strategy.plan({
      oraclePrice: 3000,
      ammPrice: 3005, // ~16.7 bps
      freeUsdc: 50,
      freeWeth: 1,
      maxTradeUsdc: 15,
    });
    expect(plan.action).toBe("ignore");
  });

  it("fades rich AMM by selling WETH", () => {
    const plan = strategy.plan({
      oraclePrice: 3000,
      ammPrice: 3100, // ~333 bps
      freeUsdc: 5,
      freeWeth: 1,
      ethUsdForInventory: 3000,
      maxTradeUsdc: 15,
    });
    expect(plan.action).toBe("propose");
    if (plan.action === "propose") {
      expect(plan.legs[0]?.tokenIn).toBe("WETH");
      expect(plan.legs[0]?.tokenOut).toBe("USDC");
      expect(plan.notionalUsdc).toBe(15);
    }
  });

  it("fades cheap AMM by buying WETH with USDC", () => {
    const plan = strategy.plan({
      oraclePrice: 3000,
      ammPrice: 2900,
      freeUsdc: 40,
      freeWeth: 0,
      maxTradeUsdc: 15,
    });
    expect(plan.action).toBe("propose");
    if (plan.action === "propose") {
      expect(plan.legs[0]?.tokenIn).toBe("USDC");
      expect(plan.legs[0]?.tokenOut).toBe("WETH");
    }
  });

  it("refuses stale oracle", () => {
    const now = Date.now();
    const plan = strategy.plan({
      oraclePrice: 3000,
      ammPrice: 3100,
      oracleUpdatedAtMs: now - 2 * 60 * 60_000,
      freeUsdc: 40,
      freeWeth: 1,
      maxTradeUsdc: 15,
      nowMs: now,
    });
    expect(plan.action).toBe("ignore");
    if (plan.action === "ignore") {
      expect(plan.reasonCodes).toContain("oracle_stale");
    }
  });

  it("refuses Sepolia thin-pool absurd basis as data_quality (not a trade)", () => {
    // Live-shaped: Chainlink ~1877.7 vs Quoter mid ~16230 (~76k bps)
    const plan = strategy.plan({
      oraclePrice: 1877.7,
      ammPrice: 16_229.706626,
      freeUsdc: 50,
      freeWeth: 1,
      maxTradeUsdc: 15,
    });
    expect(plan.action).toBe("ignore");
    if (plan.action === "ignore") {
      expect(plan.reasonCodes).toContain("basis_data_quality");
      expect(plan.reasonCodes).not.toContain("basis_below_threshold");
    }
  });

  it("honest flat markets skip with basis_below_threshold", () => {
    const plan = strategy.plan({
      oraclePrice: 2000,
      ammPrice: 2001, // +5 bps
      freeUsdc: 50,
      freeWeth: 1,
      maxTradeUsdc: 15,
    });
    expect(plan.action).toBe("ignore");
    if (plan.action === "ignore") {
      expect(plan.reasonCodes).toContain("basis_below_threshold");
      expect(plan.reasonCodes).not.toContain("basis_data_quality");
    }
  });
});
