/**
 * Phase 5 — event-linked microtrade unit tests.
 * Coverage: eligibility gates, cooldown, plan modes, reason provenance.
 */

import { describe, expect, it } from "vitest";
import {
  evaluateAndPlanEventMicrotrade,
  evaluateEventMicrotradeEligibility,
  EVENT_LINKED_MICROTRADE_REASON,
  isEventLinkedMicrotradeReasons,
  isEventMicrotradeTriggerType,
  planEventMicrotrade,
  type EventMicrotradeEligibilityInput,
  type EventMicrotradeInventory,
} from "../desk/event-microtrade-hook.ts";
import type { DeskPolicyConfig } from "../desk/types.ts";
import { isMaintenanceReasonCodes } from "../desk/strategy-rotation.ts";

function policy(overrides: Partial<DeskPolicyConfig> = {}): DeskPolicyConfig {
  return {
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
    rebalanceIntervalMs: 21_600_000,
    maintenanceNotionalUsdc: 10,
    gasElevatedGwei: 50,
    eventMicrotradeEnabled: true,
    eventMicrotradeUsdc: 5,
    eventMicrotradeCooldownMs: 3_600_000,
    eventMicrotradeLookbackMs: 3_600_000,
    paused: false,
    ...overrides,
  };
}

function baseEligibility(
  overrides: Partial<EventMicrotradeEligibilityInput> = {},
): EventMicrotradeEligibilityInput {
  return {
    enabled: true,
    deskPaused: false,
    killSwitchArmed: false,
    hasAnyOpenIntent: false,
    tickAlreadyHasIntent: false,
    lastEventMicrotradeAtMs: null,
    cooldownMs: 3_600_000,
    lookbackMs: 3_600_000,
    notionalCapUsdc: 5,
    maxTradeUsdc: 15,
    freeUsdc: 10,
    triggers: [
      {
        monitoredEventId: "evt-large-1",
        eventType: "large_swap",
        capturedAt: new Date().toISOString(),
        transactionHash: "0x" + "ab".repeat(32),
        source: "monitored_event",
      },
    ],
    nowMs: Date.now(),
    ...overrides,
  };
}

function inventory(
  overrides: Partial<EventMicrotradeInventory> = {},
): EventMicrotradeInventory {
  return {
    freeUsdc: 2,
    freeWeth: 0,
    freeLink: 0,
    aaveLinkSupplied: 40,
    totalCollateralUsd: 600,
    totalDebtUsd: 0,
    linkUsdPrice: 15,
    ethUsdPrice: 2000,
    deskEquityUsdc: 602,
    ...overrides,
  };
}

describe("event microtrade trigger types", () => {
  it("accepts large_swap, gas_spike, volume_anomaly", () => {
    expect(isEventMicrotradeTriggerType("large_swap")).toBe(true);
    expect(isEventMicrotradeTriggerType("gas_spike")).toBe(true);
    expect(isEventMicrotradeTriggerType("volume_anomaly")).toBe(true);
    expect(isEventMicrotradeTriggerType("liquidation")).toBe(false);
  });
});

describe("evaluateEventMicrotradeEligibility", () => {
  it("is disabled by default path", () => {
    const r = evaluateEventMicrotradeEligibility(
      baseEligibility({ enabled: false }),
    );
    expect(r.allow).toBe(false);
    expect(r.skipReason).toBe("disabled");
  });

  it("blocks when kill switch armed or desk paused", () => {
    expect(
      evaluateEventMicrotradeEligibility(
        baseEligibility({ killSwitchArmed: true }),
      ).skipReason,
    ).toBe("kill_switch_armed");
    expect(
      evaluateEventMicrotradeEligibility(baseEligibility({ deskPaused: true }))
        .skipReason,
    ).toBe("desk_paused");
  });

  it("blocks when open intent or tick already has intent", () => {
    expect(
      evaluateEventMicrotradeEligibility(
        baseEligibility({ hasAnyOpenIntent: true }),
      ).skipReason,
    ).toBe("open_intent");
    expect(
      evaluateEventMicrotradeEligibility(
        baseEligibility({ tickAlreadyHasIntent: true }),
      ).skipReason,
    ).toBe("tick_already_has_intent");
  });

  it("enforces cooldown", () => {
    const now = 1_700_000_000_000;
    const r = evaluateEventMicrotradeEligibility(
      baseEligibility({
        nowMs: now,
        lastEventMicrotradeAtMs: now - 60_000,
        cooldownMs: 3_600_000,
      }),
    );
    expect(r.allow).toBe(false);
    expect(r.skipReason).toBe("cooldown");
    expect(r.reasonCodes.some((c) => c.includes("cooldown"))).toBe(true);
  });

  it("allows after cooldown expires", () => {
    const now = 1_700_000_000_000;
    const r = evaluateEventMicrotradeEligibility(
      baseEligibility({
        nowMs: now,
        lastEventMicrotradeAtMs: now - 3_600_001,
        cooldownMs: 3_600_000,
      }),
    );
    expect(r.allow).toBe(true);
    expect(r.trigger?.monitoredEventId).toBe("evt-large-1");
    expect(r.notionalCapUsdc).toBe(5);
  });

  it("caps notional at min(eventCap, maxTrade)", () => {
    const r = evaluateEventMicrotradeEligibility(
      baseEligibility({ notionalCapUsdc: 20, maxTradeUsdc: 8 }),
    );
    expect(r.allow).toBe(true);
    expect(r.notionalCapUsdc).toBe(8);
  });

  it("falls back to gas_regime when no newspaper events", () => {
    const r = evaluateEventMicrotradeEligibility(
      baseEligibility({
        triggers: [],
        gasRegime: "elevated",
      }),
    );
    expect(r.allow).toBe(true);
    expect(r.trigger?.eventType).toBe("gas_regime");
    expect(r.trigger?.source).toBe("desk_gas_regime");
  });

  it("skips when no trigger and normal gas", () => {
    const r = evaluateEventMicrotradeEligibility(
      baseEligibility({
        triggers: [],
        gasRegime: "normal",
      }),
    );
    expect(r.allow).toBe(false);
    expect(r.skipReason).toBe("no_trigger");
  });

  it("ignores triggers outside lookback", () => {
    const now = Date.now();
    const r = evaluateEventMicrotradeEligibility(
      baseEligibility({
        nowMs: now,
        lookbackMs: 60_000,
        triggers: [
          {
            monitoredEventId: "old",
            eventType: "large_swap",
            capturedAt: new Date(now - 120_000).toISOString(),
          },
        ],
      }),
    );
    expect(r.allow).toBe(false);
    expect(r.skipReason).toBe("no_trigger");
  });
});

describe("planEventMicrotrade", () => {
  it("prefers maintenance free-powder with event_linked_microtrade provenance", () => {
    const result = planEventMicrotrade({
      config: policy(),
      inventory: inventory(),
      trigger: {
        monitoredEventId: "evt-1",
        eventType: "large_swap",
        transactionHash: "0xdead",
        source: "monitored_event",
      },
      notionalCapUsdc: 5,
    });

    expect(result.mode).toBe("maintenance_rebalance");
    expect(result.strategy).toBe("yield_rotation");
    expect(result.plan.action).toBe("propose");
    if (result.plan.action !== "propose") throw new Error("expected propose");
    expect(result.plan.riskIncreasing).toBe(false);
    expect(result.plan.notionalUsdc).toBeLessThanOrEqual(5);
    expect(result.plan.reasonCodes).toContain(EVENT_LINKED_MICROTRADE_REASON);
    expect(result.plan.reasonCodes).toContain("monitored_event_id=evt-1");
    expect(result.plan.reasonCodes).toContain("maintenance_rebalance");
    expect(result.plan.legs.length).toBe(2);
    expect(isMaintenanceReasonCodes(result.plan.reasonCodes)).toBe(true);
    expect(isEventLinkedMicrotradeReasons(result.plan.reasonCodes)).toBe(true);
  });

  it("plans oracle_amm when basis is valid and free USDC covers buy", () => {
    const result = planEventMicrotrade({
      config: policy({ basisBps: 50 }),
      inventory: inventory({
        aaveLinkSupplied: 0,
        totalCollateralUsd: 0,
        freeUsdc: 10,
        freeWeth: 0,
      }),
      features: {
        oraclePrice: 2000,
        ammPrice: 1900, // AMM cheap → buy WETH with USDC (~ -500 bps)
        oracleUpdatedAtMs: Date.now(),
      },
      trigger: {
        monitoredEventId: "evt-basis",
        eventType: "volume_anomaly",
        source: "monitored_event",
      },
      notionalCapUsdc: 5,
      nowMs: Date.now(),
    });

    expect(result.mode).toBe("oracle_amm");
    expect(result.strategy).toBe("oracle_amm");
    expect(result.plan.action).toBe("propose");
    if (result.plan.action !== "propose") throw new Error("expected propose");
    expect(result.plan.riskIncreasing).toBe(true);
    expect(result.plan.reasonCodes).toContain(EVENT_LINKED_MICROTRADE_REASON);
    expect(result.plan.notionalUsdc).toBeLessThanOrEqual(5);
  });

  it("refuses absurd basis (data quality) when no maintenance inventory", () => {
    const result = planEventMicrotrade({
      config: policy(),
      inventory: inventory({
        aaveLinkSupplied: 0,
        totalCollateralUsd: 0,
        freeUsdc: 20,
      }),
      features: {
        oraclePrice: 2000,
        ammPrice: 16000, // absurd thin-pool scale
        oracleUpdatedAtMs: Date.now(),
      },
      trigger: {
        monitoredEventId: "evt-dq",
        eventType: "large_swap",
      },
      notionalCapUsdc: 5,
      nowMs: Date.now(),
    });

    expect(result.mode).toBe("none");
    expect(result.plan.action).toBe("ignore");
    expect(result.plan.reasonCodes).toContain("no_executable_plan");
  });

  it("ignores when no freeable inventory and no free USDC for oracle", () => {
    const result = planEventMicrotrade({
      config: policy(),
      inventory: inventory({
        aaveLinkSupplied: 0,
        totalCollateralUsd: 0,
        freeUsdc: 0,
        freeWeth: 0,
      }),
      trigger: {
        monitoredEventId: "evt-empty",
        eventType: "gas_spike",
      },
      notionalCapUsdc: 5,
    });
    expect(result.mode).toBe("none");
    expect(result.plan.action).toBe("ignore");
  });
});

describe("evaluateAndPlanEventMicrotrade", () => {
  it("replayed large_swap leads to ≤1 policy-capped plan with event_linked_microtrade", () => {
    const { eligibility, planResult } = evaluateAndPlanEventMicrotrade({
      eligibility: baseEligibility(),
      inventory: inventory(),
      config: policy(),
    });

    expect(eligibility.allow).toBe(true);
    expect(planResult).not.toBeNull();
    expect(planResult!.plan.action).toBe("propose");
    if (planResult!.plan.action !== "propose") throw new Error("expected propose");
    expect(planResult!.plan.notionalUsdc).toBeLessThanOrEqual(5);
    expect(planResult!.plan.reasonCodes).toContain(
      EVENT_LINKED_MICROTRADE_REASON,
    );
    expect(planResult!.plan.reasonCodes).toContain(
      "monitored_event_id=evt-large-1",
    );
  });

  it("returns no plan when eligibility fails", () => {
    const { eligibility, planResult } = evaluateAndPlanEventMicrotrade({
      eligibility: baseEligibility({ enabled: false }),
      inventory: inventory(),
      config: policy({ eventMicrotradeEnabled: false }),
    });
    expect(eligibility.allow).toBe(false);
    expect(planResult).toBeNull();
  });
});
