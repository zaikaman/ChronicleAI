import { describe, expect, it } from "vitest";
import {
  createPolicyEngine,
  detectPowderThrash,
  evaluateFreeInventoryShortfall,
  evaluateSweepEligibility,
  evaluateTopupEligibility,
} from "../desk/policy-engine.ts";
import type { DeskPolicyConfig, PolicyEvaluationContext } from "../desk/types.ts";

const baseConfig: DeskPolicyConfig = {
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

function ctx(
  partial: Partial<PolicyEvaluationContext> &
    Pick<PolicyEvaluationContext, "strategy">,
): PolicyEvaluationContext {
  return {
    riskIncreasing: partial.strategy !== "risk_defend",
    proposedNotionalUsdc: 10,
    deskEquityUsdc: 50,
    freeUsdc: 40,
    openByStrategy: {},
    gasRegime: "normal",
    killSwitchArmed: false,
    ...partial,
  };
}

describe("policy-engine", () => {
  const engine = createPolicyEngine(baseConfig);

  it("allows a normal oracle_amm trade within caps", () => {
    const decision = engine.evaluate(ctx({ strategy: "oracle_amm" }));
    expect(decision.allow).toBe(true);
    expect(decision.verdict).toBe("trade");
    expect(decision.sizedNotionalUsdc).toBe(10);
    expect(decision.reasonCodes).toContain("policy_ok");
  });

  it("defers risk-increasing intents when kill switch is armed", () => {
    const decision = engine.evaluate(
      ctx({ strategy: "oracle_amm", killSwitchArmed: true }),
    );
    expect(decision.allow).toBe(false);
    expect(decision.reasonCodes).toContain("kill_switch_armed");
  });

  it("still allows risk_defend when kill switch is armed", () => {
    const decision = engine.evaluate(
      ctx({
        strategy: "risk_defend",
        riskIncreasing: false,
        killSwitchArmed: true,
        proposedNotionalUsdc: 5,
      }),
    );
    expect(decision.allow).toBe(true);
    expect(decision.verdict).toBe("defend");
  });

  it("sizes inventory-backed maintenance free-powder without free USDC", () => {
    const decision = engine.evaluate(
      ctx({
        strategy: "yield_rotation",
        riskIncreasing: false,
        freeUsdc: 0,
        proposedNotionalUsdc: 10,
        deskEquityUsdc: 600,
      }),
    );
    expect(decision.allow).toBe(true);
    expect(decision.sizedNotionalUsdc).toBe(10);
    expect(decision.reasonCodes).not.toContain("notional_zero");
  });

  it("still zero-sizes risk-increasing rotation when free USDC is 0", () => {
    const decision = engine.evaluate(
      ctx({
        strategy: "yield_rotation",
        riskIncreasing: true,
        freeUsdc: 0,
        proposedNotionalUsdc: 10,
      }),
    );
    expect(decision.allow).toBe(false);
    expect(decision.reasonCodes).toContain("notional_zero");
  });

  it("defers non-defend when gas is elevated", () => {
    const decision = engine.evaluate(
      ctx({ strategy: "yield_rotation", gasRegime: "elevated" }),
    );
    expect(decision.allow).toBe(false);
    expect(decision.reasonCodes).toContain("gas_regime_elevated");
  });

  it("enforces single-flight per strategy", () => {
    const decision = engine.evaluate(
      ctx({
        strategy: "oracle_amm",
        openByStrategy: { oracle_amm: true },
      }),
    );
    expect(decision.allow).toBe(false);
    expect(decision.reasonCodes).toContain("single_flight_strategy");
  });

  it("caps notional to maxTrade and free USDC", () => {
    const sized = engine.sizeNotional(100, 8, 50);
    expect(sized).toBe(8);
  });

  it("refuses opens when equity would breach floor", () => {
    const decision = engine.evaluate(
      ctx({
        strategy: "oracle_amm",
        deskEquityUsdc: 25,
        freeUsdc: 20,
        proposedNotionalUsdc: 15,
      }),
    );
    // sized to min(15, 20, 25-20=5) = 5, equity 25-5=20 == floor → ok
    // Actually deskEquity - sized >= minAum: 25-5=20 ok
    expect(decision.sizedNotionalUsdc).toBe(5);
  });

  it("blocks risk-increasing when simulated HF below warn", () => {
    const decision = engine.evaluate(
      ctx({
        strategy: "yield_rotation",
        simulatedHfAfter: 1.1,
      }),
    );
    expect(decision.allow).toBe(false);
    expect(decision.reasonCodes).toContain("simulated_hf_below_warn");
  });

  it("refuses stale oracle for non-defend", () => {
    const now = Date.now();
    const decision = engine.evaluate(
      ctx({
        strategy: "oracle_amm",
        oracleUpdatedAtMs: now - 2 * 60 * 60_000,
        nowMs: now,
      }),
    );
    expect(decision.allow).toBe(false);
    expect(decision.reasonCodes).toContain("oracle_stale");
  });

  it("enforces failed-run cooldown", () => {
    const now = Date.now();
    const decision = engine.evaluate(
      ctx({
        strategy: "oracle_amm",
        lastFailedAtMsByStrategy: { oracle_amm: now - 60_000 },
        nowMs: now,
      }),
    );
    expect(decision.allow).toBe(false);
    expect(decision.reasonCodes).toContain("failed_run_cooldown");
  });

  it("picks risk_defend over other strategies", () => {
    expect(
      engine.pickStrategy(["oracle_amm", "risk_defend", "yield_rotation"]),
    ).toBe("risk_defend");
  });

  it("classifies gas regime from gwei", () => {
    expect(engine.classifyGasRegime(10)).toBe("normal");
    expect(engine.classifyGasRegime(50)).toBe("elevated");
    expect(engine.classifyGasRegime(100)).toBe("critical");
  });
});

describe("capital eligibility", () => {
  it("allows top-up when desk below target and treasury has reserve+chunk", () => {
    const result = evaluateTopupEligibility({
      treasuryUsdc: 100,
      usdcOperatingReserve: 20,
      chunkUsdc: 10,
      deskEquityUsdc: 30,
      targetAumUsdc: 50,
      minAumUsdc: 20,
      maxAumUsdc: 80,
      lastTopupAtMs: null,
      topupCooldownMs: 3_600_000,
      deskPaused: false,
      killSwitchArmed: false,
    });
    expect(result.eligible).toBe(true);
    expect(result.amountUsdc).toBe(10);
  });

  it("blocks top-up when treasury cannot keep operating reserve", () => {
    const result = evaluateTopupEligibility({
      treasuryUsdc: 25,
      usdcOperatingReserve: 20,
      chunkUsdc: 10,
      deskEquityUsdc: 10,
      targetAumUsdc: 50,
      minAumUsdc: 20,
      maxAumUsdc: 80,
      lastTopupAtMs: null,
      topupCooldownMs: 3_600_000,
      deskPaused: false,
      killSwitchArmed: false,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("treasury_usdc_below_reserve_plus_chunk");
  });

  it("blocks top-up during cooldown", () => {
    const now = 1_000_000;
    const result = evaluateTopupEligibility({
      treasuryUsdc: 100,
      usdcOperatingReserve: 0,
      chunkUsdc: 10,
      deskEquityUsdc: 10,
      targetAumUsdc: 50,
      minAumUsdc: 20,
      maxAumUsdc: 80,
      lastTopupAtMs: now - 60_000,
      topupCooldownMs: 3_600_000,
      deskPaused: false,
      killSwitchArmed: false,
      nowMs: now,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("topup_cooldown");
  });

  it("blocks top-up that would exceed max AUM", () => {
    const result = evaluateTopupEligibility({
      treasuryUsdc: 100,
      usdcOperatingReserve: 0,
      chunkUsdc: 10,
      deskEquityUsdc: 75,
      targetAumUsdc: 50,
      minAumUsdc: 20,
      maxAumUsdc: 80,
      lastTopupAtMs: null,
      topupCooldownMs: 3_600_000,
      deskPaused: false,
      killSwitchArmed: false,
    });
    // 75 < 50 is false — at above target
    expect(result.eligible).toBe(false);
  });

  it("sweeps excess when equity above max AUM (no powder reserve)", () => {
    const result = evaluateSweepEligibility({
      deskEquityUsdc: 100,
      freeUsdcOnDesk: 40,
      targetAumUsdc: 50,
      maxAumUsdc: 80,
      profitSweepUsdc: 15,
      killSwitchArmed: false,
    });
    expect(result.eligible).toBe(true);
    expect(result.amountUsdc).toBe(40); // min(free, equity-target)=min(40,50)=40
    expect(result.reason).toBe("desk_equity_above_max_aum");
  });

  it("caps max-AUM sweep by minFree powder reserve", () => {
    const result = evaluateSweepEligibility({
      deskEquityUsdc: 100,
      freeUsdcOnDesk: 40,
      targetAumUsdc: 50,
      maxAumUsdc: 80,
      profitSweepUsdc: 15,
      killSwitchArmed: false,
      minFreeUsdc: 10,
    });
    expect(result.eligible).toBe(true);
    // desired min(40, 50)=40, sweepable=30 → 30
    expect(result.amountUsdc).toBe(30);
    expect(result.reason).toBe("desk_equity_above_max_aum");
  });

  it("emergency sweep returns all free USDC including powder reserve", () => {
    const result = evaluateSweepEligibility({
      deskEquityUsdc: 40,
      freeUsdcOnDesk: 12.5,
      targetAumUsdc: 50,
      maxAumUsdc: 80,
      profitSweepUsdc: 15,
      killSwitchArmed: true,
      minFreeUsdc: 10,
    });
    expect(result.eligible).toBe(true);
    expect(result.amountUsdc).toBe(12.5);
    expect(result.emergency).toBe(true);
  });

  it("allows force inventory top-up when equity already at target", () => {
    const result = evaluateTopupEligibility({
      treasuryUsdc: 100,
      usdcOperatingReserve: 20,
      chunkUsdc: 10,
      deskEquityUsdc: 50,
      targetAumUsdc: 50,
      minAumUsdc: 20,
      maxAumUsdc: 80,
      lastTopupAtMs: null,
      topupCooldownMs: 3_600_000,
      deskPaused: false,
      killSwitchArmed: false,
      forceInventoryTopup: true,
    });
    expect(result.eligible).toBe(true);
    expect(result.reason).toBe("free_usdc_shortfall_no_unwind");
    expect(result.amountUsdc).toBe(10);
  });
});

describe("powder-safe sweep eligibility matrix (free powder thrash fix)", () => {
  const base = {
    targetAumUsdc: 50,
    maxAumUsdc: 80,
    profitSweepUsdc: 15,
    killSwitchArmed: false,
    minFreeUsdc: 10,
  };

  it("skips when free is 0 and equity above max", () => {
    const result = evaluateSweepEligibility({
      ...base,
      deskEquityUsdc: 1000,
      freeUsdcOnDesk: 0,
    });
    expect(result.eligible).toBe(false);
    expect(result.amountUsdc).toBe(0);
    expect(result.reason).toBe("equity_above_max_no_free_usdc");
  });

  it("skips when all free is reserved for powder (free 5 < min 10)", () => {
    const result = evaluateSweepEligibility({
      ...base,
      deskEquityUsdc: 1000,
      freeUsdcOnDesk: 5,
    });
    expect(result.eligible).toBe(false);
    expect(result.amountUsdc).toBe(0);
    expect(result.reason).toBe("equity_above_max_but_free_usdc_reserved");
  });

  it("skips when free equals powder floor under over-max equity", () => {
    const result = evaluateSweepEligibility({
      ...base,
      deskEquityUsdc: 1000,
      freeUsdcOnDesk: 10,
    });
    expect(result.eligible).toBe(false);
    expect(result.amountUsdc).toBe(0);
    expect(result.reason).toBe("equity_above_max_but_free_usdc_reserved");
  });

  it("sweeps at most free − minFree when free=12 equity≫max", () => {
    const result = evaluateSweepEligibility({
      ...base,
      deskEquityUsdc: 1000,
      freeUsdcOnDesk: 12,
    });
    expect(result.eligible).toBe(true);
    expect(result.amountUsdc).toBeLessThanOrEqual(2);
    expect(result.amountUsdc).toBe(2);
    expect(result.reason).toBe("desk_equity_above_max_aum");
  });

  it("sweeps at most free − minFree when free=25 equity≫max", () => {
    const result = evaluateSweepEligibility({
      ...base,
      deskEquityUsdc: 1000,
      freeUsdcOnDesk: 25,
    });
    expect(result.eligible).toBe(true);
    expect(result.amountUsdc).toBeLessThanOrEqual(15);
    expect(result.amountUsdc).toBe(15);
    expect(result.reason).toBe("desk_equity_above_max_aum");
  });

  it("does not max-AUM sweep when equity under max (profit path only)", () => {
    const result = evaluateSweepEligibility({
      ...base,
      deskEquityUsdc: 40,
      freeUsdcOnDesk: 25,
      // profit: free 25 >= 15 and equity after sweep would be 40-? need leave ≥ target 50
      // 40 - amount >= 50 is impossible → no profit sweep
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("no_sweep_needed");
  });

  it("signals strategy unwind when equity over max, free 0, freeable inventory", () => {
    const result = evaluateSweepEligibility({
      ...base,
      deskEquityUsdc: 1000,
      freeUsdcOnDesk: 0,
      hasFreeableInventory: true,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("equity_above_max_requires_strategy_unwind");
  });

  it("post-maintenance cooldown skips max-AUM unless free well above powder", () => {
    const now = 10_000_000;
    const result = evaluateSweepEligibility({
      ...base,
      deskEquityUsdc: 1000,
      freeUsdcOnDesk: 12,
      lastFreePowderFillAtMs: now - 60_000,
      postMaintenanceSweepCooldownMs: 20 * 60_000,
      nowMs: now,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("post_maintenance_sweep_cooldown");
  });

  it("post-maintenance cooldown allows sweep when free ≫ powder + profit", () => {
    const now = 10_000_000;
    const result = evaluateSweepEligibility({
      ...base,
      deskEquityUsdc: 1000,
      freeUsdcOnDesk: 40, // > 10 + 15
      lastFreePowderFillAtMs: now - 60_000,
      postMaintenanceSweepCooldownMs: 20 * 60_000,
      nowMs: now,
    });
    expect(result.eligible).toBe(true);
    expect(result.amountUsdc).toBe(30); // 40 - 10 reserve
    expect(result.reason).toBe("desk_equity_above_max_aum");
  });

  it("thrash suppress blocks max-AUM when free near powder", () => {
    const result = evaluateSweepEligibility({
      ...base,
      deskEquityUsdc: 1000,
      freeUsdcOnDesk: 12,
      suppressMaxAumSweep: true,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("desk_powder_thrash_detected");
  });

  it("detectPowderThrash is true for alternating sweep + shortfall pattern", () => {
    expect(
      detectPowderThrash({
        recentCapitalMoves: [
          { direction: "sweep", reason: "desk_equity_above_max_aum" },
          { direction: "sweep", reason: "desk_equity_above_max_aum" },
          { direction: "sweep", reason: "desk_equity_above_max_aum" },
        ],
        recentFilledIntents: [
          { reasonCodes: ["yield_rotation", "free_usdc_shortfall"] },
          { reasonCodes: ["free_usdc_shortfall"] },
          { reasonCodes: ["out_of_aave_link", "free_usdc_shortfall"] },
        ],
      }),
    ).toBe(true);
  });

  it("detectPowderThrash is false when capital moves are mixed", () => {
    expect(
      detectPowderThrash({
        recentCapitalMoves: [
          { direction: "sweep" },
          { direction: "topup" },
          { direction: "sweep" },
        ],
        recentFilledIntents: [
          { reasonCodes: ["free_usdc_shortfall"] },
          { reasonCodes: ["free_usdc_shortfall"] },
          { reasonCodes: ["free_usdc_shortfall"] },
        ],
      }),
    ).toBe(false);
  });
});

describe("free inventory shortfall decision matrix (A1)", () => {
  const base = {
    freeUsdcOnDesk: 0,
    minFreeUsdc: 10,
    inventoryTopupUsdc: 10,
    preferUnwindForFreeUsdc: true,
    deskEquityUsdc: 600,
    minAumUsdc: 20,
    targetAumUsdc: 50,
    maxAumUsdc: 80,
    deskPaused: false,
    killSwitchArmed: false,
  };

  it("returns ok when free USDC already meets floor", () => {
    const result = evaluateFreeInventoryShortfall({
      ...base,
      freeUsdcOnDesk: 12,
    });
    expect(result.kind).toBe("ok");
    expect(result.reason).toBe("free_usdc_at_or_above_min");
  });

  it("prefers free_inventory when equity high and Aave LINK freeable", () => {
    const result = evaluateFreeInventoryShortfall({
      ...base,
      freeUsdcOnDesk: 0,
      aaveTotalCollateralUsd: 637,
      aaveTotalDebtUsd: 0,
      linkUsdPrice: 15,
    });
    expect(result.kind).toBe("free_inventory");
    if (result.kind === "free_inventory") {
      expect(result.amountUsdc).toBe(10);
      expect(result.source).toBe("aave_link");
      expect(result.reason).toBe("free_usdc_shortfall_unwind");
    }
  });

  it("prefers free_inventory from free LINK when priced ≥ chunk", () => {
    const result = evaluateFreeInventoryShortfall({
      ...base,
      freeUsdcOnDesk: 2,
      freeLinkOnDesk: 5,
      linkUsdPrice: 15, // 75 USD free LINK
      aaveTotalCollateralUsd: 0,
      aaveTotalDebtUsd: 0,
    });
    expect(result.kind).toBe("free_inventory");
    if (result.kind === "free_inventory") {
      expect(result.source).toBe("free_link");
      expect(result.amountUsdc).toBe(10);
    }
  });

  it("requests inventory top-up when no collateral to free", () => {
    const result = evaluateFreeInventoryShortfall({
      ...base,
      // Equity at target so inventory top-up can grow free powder without exceeding max AUM
      deskEquityUsdc: 50,
      freeUsdcOnDesk: 0,
      aaveTotalCollateralUsd: 0,
      aaveTotalDebtUsd: 0,
      freeLinkOnDesk: 0,
    });
    expect(result.kind).toBe("topup_inventory");
    if (result.kind === "topup_inventory") {
      expect(result.reason).toBe("free_usdc_shortfall_no_unwind");
      expect(result.amountUsdc).toBe(10);
    }
  });

  it("does not free inventory when Aave collateral is unpriced (no LINK/USD)", () => {
    // Without a price we cannot size withdraw+swap — fall through to treasury top-up
    // instead of deciding free_inventory and failing at execute (link_price_unavailable).
    const result = evaluateFreeInventoryShortfall({
      ...base,
      deskEquityUsdc: 50,
      freeUsdcOnDesk: 0,
      aaveTotalCollateralUsd: 637,
      aaveTotalDebtUsd: 0,
      freeLinkOnDesk: 0,
      linkUsdPrice: null,
    });
    expect(result.kind).toBe("topup_inventory");
    expect(result.reason).toBe("free_usdc_shortfall_no_unwind");
  });

  it("does not free inventory when Aave has material debt", () => {
    const result = evaluateFreeInventoryShortfall({
      ...base,
      deskEquityUsdc: 50,
      freeUsdcOnDesk: 0,
      aaveTotalCollateralUsd: 500,
      aaveTotalDebtUsd: 200,
      freeLinkOnDesk: 0,
    });
    expect(result.kind).toBe("topup_inventory");
    expect(result.reason).toBe("free_usdc_shortfall_no_unwind");
  });

  it("defers free_inventory under min AUM so equity top-up can run", () => {
    const result = evaluateFreeInventoryShortfall({
      ...base,
      freeUsdcOnDesk: 0,
      deskEquityUsdc: 10,
      aaveTotalCollateralUsd: 100,
      aaveTotalDebtUsd: 0,
      linkUsdPrice: 15,
    });
    expect(result.kind).toBe("skip");
    expect(result.reason).toBe("free_usdc_shortfall_under_min_aum_prefer_topup");
  });

  it("honors preferUnwind=false with treasury inventory top-up when over target", () => {
    const result = evaluateFreeInventoryShortfall({
      ...base,
      preferUnwindForFreeUsdc: false,
      deskEquityUsdc: 50,
      freeUsdcOnDesk: 0,
      aaveTotalCollateralUsd: 637,
      aaveTotalDebtUsd: 0,
      linkUsdPrice: 15,
    });
    expect(result.kind).toBe("topup_inventory");
    if (result.kind === "topup_inventory") {
      expect(result.reason).toBe("free_usdc_shortfall_prefer_treasury");
    }
  });

  it("skips treasury top-up path when equity far above max AUM and unwind disabled", () => {
    const result = evaluateFreeInventoryShortfall({
      ...base,
      preferUnwindForFreeUsdc: false,
      deskEquityUsdc: 600,
      freeUsdcOnDesk: 0,
      aaveTotalCollateralUsd: 637,
      aaveTotalDebtUsd: 0,
      linkUsdPrice: 15,
    });
    expect(result.kind).toBe("skip");
    expect(result.reason).toBe("prefer_unwind_disabled_max_aum");
  });

  it("skips when desk is paused", () => {
    const result = evaluateFreeInventoryShortfall({
      ...base,
      deskPaused: true,
      aaveTotalCollateralUsd: 100,
    });
    expect(result.kind).toBe("skip");
    expect(result.reason).toBe("desk_paused");
  });

  it("skips when unwind impossible and top-up would exceed max AUM", () => {
    const result = evaluateFreeInventoryShortfall({
      ...base,
      freeUsdcOnDesk: 0,
      deskEquityUsdc: 75,
      maxAumUsdc: 80,
      inventoryTopupUsdc: 10, // 75+10 > 80
      aaveTotalCollateralUsd: 0,
    });
    expect(result.kind).toBe("skip");
    expect(result.reason).toBe("insufficient_collateral_to_free_max_aum");
  });
});
