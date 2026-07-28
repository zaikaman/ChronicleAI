import { describe, expect, it } from "vitest";
import {
  defaultCctpPolicyConfig,
  evaluateRebalancePolicy,
  maxFeeUsdcToAtomic,
  selectRebalanceAmountUsdc,
} from "../cctp/rebalance-policy.ts";
import type { CctpPolicyInput, CctpTreasuryBalances } from "../cctp/types.ts";

function balances(
  partial: Partial<CctpTreasuryBalances> = {},
): CctpTreasuryBalances {
  return {
    treasuryBaseUsdc: 50,
    treasurySepoliaUsdc: 1,
    treasuryBaseEth: 0.05,
    treasurySepoliaEth: 0.05,
    inFlightUsdc: 0,
    ...partial,
  };
}

function input(
  partial: {
    balances?: Partial<CctpTreasuryBalances>;
    inFlightCount?: number;
    lastSuccessfulBurnAt?: string | null;
    nowMs?: number;
    mode?: CctpPolicyInput["mode"];
    deskStarved?: boolean;
    amountOverrideUsdc?: number;
  } = {},
): CctpPolicyInput {
  const { balances: b, ...rest } = partial;
  return {
    balances: balances(b),
    inFlightCount: 0,
    lastSuccessfulBurnAt: null,
    nowMs: 1_000_000,
    mode: "direct",
    ...rest,
  };
}

describe("selectRebalanceAmountUsdc", () => {
  it("selects chunk when surplus is large", () => {
    const r = selectRebalanceAmountUsdc({
      treasuryBaseUsdc: 100,
      baseSafetyBufferUsdc: 5,
      rebalanceChunkUsdc: 10,
      rebalanceMaxChunkUsdc: 50,
    });
    expect(r.amountUsdc).toBe(10);
    expect(r.availableAboveBufferUsdc).toBe(95);
  });

  it("caps at available above buffer", () => {
    const r = selectRebalanceAmountUsdc({
      treasuryBaseUsdc: 12,
      baseSafetyBufferUsdc: 5,
      rebalanceChunkUsdc: 10,
      rebalanceMaxChunkUsdc: 50,
    });
    expect(r.amountUsdc).toBe(7);
  });

  it("respects max chunk", () => {
    const r = selectRebalanceAmountUsdc({
      treasuryBaseUsdc: 1000,
      baseSafetyBufferUsdc: 5,
      rebalanceChunkUsdc: 100,
      rebalanceMaxChunkUsdc: 50,
    });
    expect(r.amountUsdc).toBe(50);
  });

  it("applies override capped by max and available", () => {
    const r = selectRebalanceAmountUsdc({
      treasuryBaseUsdc: 30,
      baseSafetyBufferUsdc: 5,
      rebalanceChunkUsdc: 10,
      rebalanceMaxChunkUsdc: 50,
      amountOverrideUsdc: 100,
    });
    expect(r.amountUsdc).toBe(25);
  });

  it("floors to 6 decimal places", () => {
    const r = selectRebalanceAmountUsdc({
      treasuryBaseUsdc: 10.123456789,
      baseSafetyBufferUsdc: 5,
      rebalanceChunkUsdc: 10,
      rebalanceMaxChunkUsdc: 50,
    });
    expect(r.availableAboveBufferUsdc).toBe(5.123456);
  });
});

describe("maxFeeUsdcToAtomic", () => {
  it("converts 0.05 USDC to 50000 atomic", () => {
    expect(maxFeeUsdcToAtomic(0.05)).toBe(50_000n);
  });

  it("returns 0 for invalid", () => {
    expect(maxFeeUsdcToAtomic(-1)).toBe(0n);
    expect(maxFeeUsdcToAtomic(Number.NaN)).toBe(0n);
  });
});

describe("evaluateRebalancePolicy", () => {
  const config = defaultCctpPolicyConfig();

  it("is eligible with healthy surplus and gas", () => {
    const d = evaluateRebalancePolicy(config, input());
    expect(d.eligible).toBe(true);
    expect(d.reason).toBe("eligible");
    expect(d.amountUsdc).toBe(10);
    expect(d.amountAtomic).toBe("10000000");
    expect(BigInt(d.maxFeeAtomic)).toBe(50_000n);
  });

  it("skips when disabled", () => {
    const d = evaluateRebalancePolicy(
      defaultCctpPolicyConfig({ enabled: false }),
      input(),
    );
    expect(d.eligible).toBe(false);
    expect(d.reason).toBe("disabled");
  });

  it("skips when emergency paused", () => {
    const d = evaluateRebalancePolicy(
      defaultCctpPolicyConfig({ emergencyPaused: true }),
      input(),
    );
    expect(d.eligible).toBe(false);
    expect(d.reason).toBe("emergency_paused");
  });

  it("skips when in-flight at cap", () => {
    const d = evaluateRebalancePolicy(
      config,
      input({ inFlightCount: 1 }),
    );
    expect(d.eligible).toBe(false);
    expect(d.reason).toBe("max_in_flight");
  });

  it("allows in-flight under cap", () => {
    const d = evaluateRebalancePolicy(
      defaultCctpPolicyConfig({ maxInFlight: 2 }),
      input({ inFlightCount: 1 }),
    );
    expect(d.eligible).toBe(true);
  });

  it("skips during cooldown", () => {
    const d = evaluateRebalancePolicy(
      config,
      input({
        lastSuccessfulBurnAt: new Date(1_000_000 - 60_000).toISOString(),
        nowMs: 1_000_000,
      }),
    );
    expect(d.eligible).toBe(false);
    expect(d.reason).toBe("cooldown");
  });

  it("allows after cooldown elapsed", () => {
    const d = evaluateRebalancePolicy(
      config,
      input({
        lastSuccessfulBurnAt: new Date(1_000_000 - 900_001).toISOString(),
        nowMs: 1_000_000,
      }),
    );
    expect(d.eligible).toBe(true);
  });

  it("skips cooldown when forceOnDeskStarvation + deskStarved", () => {
    const d = evaluateRebalancePolicy(
      defaultCctpPolicyConfig({ forceOnDeskStarvation: true }),
      input({
        lastSuccessfulBurnAt: new Date(1_000_000 - 1_000).toISOString(),
        deskStarved: true,
        nowMs: 1_000_000,
      }),
    );
    expect(d.eligible).toBe(true);
  });

  it("does not skip cooldown when force flag set but desk not starved", () => {
    const d = evaluateRebalancePolicy(
      defaultCctpPolicyConfig({ forceOnDeskStarvation: true }),
      input({
        lastSuccessfulBurnAt: new Date(1_000_000 - 1_000).toISOString(),
        deskStarved: false,
        nowMs: 1_000_000,
      }),
    );
    expect(d.eligible).toBe(false);
    expect(d.reason).toBe("cooldown");
  });

  it("skips below threshold", () => {
    // buffer 5, threshold 10 → need base >= 15
    const d = evaluateRebalancePolicy(
      config,
      input({ balances: { treasuryBaseUsdc: 14 } }),
    );
    expect(d.eligible).toBe(false);
    expect(d.reason).toBe("below_threshold");
  });

  it("eligible exactly at threshold boundary", () => {
    // base 15, buffer 5 → surplus 10 === threshold; fee 0.05 shrinks amount so residual stays ≥ buffer
    const d = evaluateRebalancePolicy(
      config,
      input({ balances: { treasuryBaseUsdc: 15 } }),
    );
    expect(d.eligible).toBe(true);
    expect(d.amountUsdc).toBe(9.95);
    expect(15 - d.amountUsdc - 0.05 + 1e-9).toBeGreaterThanOrEqual(5);
  });

  it("skips insufficient Base gas", () => {
    const d = evaluateRebalancePolicy(
      config,
      input({ balances: { treasuryBaseEth: 0.001 } }),
    );
    expect(d.eligible).toBe(false);
    expect(d.reason).toBe("insufficient_base_gas");
  });

  it("skips insufficient Sepolia gas for direct mode", () => {
    const d = evaluateRebalancePolicy(
      config,
      input({
        mode: "direct",
        balances: { treasurySepoliaEth: 0.001 },
      }),
    );
    expect(d.eligible).toBe(false);
    expect(d.reason).toBe("insufficient_sepolia_gas");
  });

  it("does not require Sepolia gas for forwarding mode", () => {
    const d = evaluateRebalancePolicy(
      config,
      input({
        mode: "forwarding",
        balances: { treasurySepoliaEth: 0 },
      }),
    );
    expect(d.eligible).toBe(true);
  });

  it("does not require Sepolia gas when requireSepoliaGasForDirectMint=false", () => {
    const d = evaluateRebalancePolicy(
      defaultCctpPolicyConfig({ requireSepoliaGasForDirectMint: false }),
      input({
        mode: "direct",
        balances: { treasurySepoliaEth: 0 },
      }),
    );
    expect(d.eligible).toBe(true);
  });

  it("rejects invalid balances", () => {
    const d = evaluateRebalancePolicy(
      config,
      input({
        balances: { treasuryBaseUsdc: Number.NaN },
      }),
    );
    expect(d.eligible).toBe(false);
    expect(d.reason).toBe("invalid_balances");
  });

  it("never burns into safety buffer", () => {
    // base 16, buffer 5 → available 11, chunk 10 → amount 10, residual 6 >= 5
    const d = evaluateRebalancePolicy(
      config,
      input({ balances: { treasuryBaseUsdc: 16 } }),
    );
    expect(d.eligible).toBe(true);
    expect(d.amountUsdc).toBe(10);
    expect(16 - d.amountUsdc).toBeGreaterThanOrEqual(5);
  });

  it("shrinks amount when fee would violate buffer", () => {
    // maxFee 0.05, buffer 5, base just above threshold
    // base 15.04, amount 10, fee 0.05 → residual 4.99 < 5 → shrink
    const d = evaluateRebalancePolicy(
      defaultCctpPolicyConfig({ maxFeeUsdc: 0.05 }),
      input({ balances: { treasuryBaseUsdc: 15.04 } }),
    );
    expect(d.eligible).toBe(true);
    expect(d.amountUsdc).toBeLessThanOrEqual(10);
    expect(15.04 - d.amountUsdc - 0.05 + 1e-9).toBeGreaterThanOrEqual(5);
  });

  it("force override amount still capped by max chunk", () => {
    const d = evaluateRebalancePolicy(
      config,
      input({
        amountOverrideUsdc: 100,
        balances: { treasuryBaseUsdc: 200 },
      }),
    );
    expect(d.eligible).toBe(true);
    expect(d.amountUsdc).toBe(50);
  });

  it("force override of 1 USDC works even below threshold", () => {
    const d = evaluateRebalancePolicy(
      config,
      input({
        amountOverrideUsdc: 1,
        balances: { treasuryBaseUsdc: 10 }, // surplus 5 < threshold 10
      }),
    );
    expect(d.eligible).toBe(true);
    expect(d.amountUsdc).toBe(1);
  });

  it("amount_zero when override exceeds available", () => {
    const d = evaluateRebalancePolicy(
      config,
      input({
        amountOverrideUsdc: 10,
        balances: { treasuryBaseUsdc: 5 }, // available 0
      }),
    );
    expect(d.eligible).toBe(false);
    expect(d.reason).toBe("amount_zero");
  });

  it("amount atomic matches 6 decimals", () => {
    const d = evaluateRebalancePolicy(
      defaultCctpPolicyConfig({ rebalanceChunkUsdc: 1.5 }),
      input({ balances: { treasuryBaseUsdc: 100 } }),
    );
    expect(d.eligible).toBe(true);
    expect(d.amountAtomic).toBe("1500000");
  });
});
