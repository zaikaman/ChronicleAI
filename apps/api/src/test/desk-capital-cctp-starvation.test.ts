import { describe, expect, it, vi } from "vitest";
import { createCapitalManager } from "../desk/capital-manager.ts";
import type { DeskPolicyConfig } from "../desk/types.ts";
import type { DeskCapitalMoveRepository } from "@chronicleai/db";

function policy(overrides: Partial<DeskPolicyConfig> = {}): DeskPolicyConfig {
  return {
    targetAumUsdc: 50,
    maxAumUsdc: 80,
    minAumUsdc: 20,
    topupChunkUsdc: 10,
    minFreeUsdc: 10,
    inventoryTopupUsdc: 10,
    preferUnwindForFreeUsdc: true,
    profitSweepUsdc: 20,
    topupCooldownMs: 3_600_000,
    postMaintenanceSweepCooldownMs: 1_200_000,
    maxTradeUsdc: 25,
    hfWarn: 1.2,
    hfCritical: 1.05,
    basisBps: 30,
    apyDeltaBps: 50,
    gasElevatedGwei: 40,
    killHeartbeatMs: 120_000,
    failedRunCooldownMs: 15 * 60_000,
    oracleMaxStalenessMs: 60 * 60_000,
    apyConsecutivePolls: 2,
    apyAbsurdBps: 5000,
    rebalanceIntervalMs: 21_600_000,
    maintenanceNotionalUsdc: 10,
    eventMicrotradeEnabled: false,
    eventMicrotradeUsdc: 5,
    eventMicrotradeCooldownMs: 3_600_000,
    eventMicrotradeLookbackMs: 3_600_000,
    paused: false,
    ...overrides,
  };
}

function mockCapitalMoves(): DeskCapitalMoveRepository {
  return {
    create: vi.fn(),
    update: vi.fn(),
    findById: vi.fn(),
    listRecent: vi.fn(), listPage: vi.fn(),
      findLatestByDirection: vi.fn(),
  } as unknown as DeskCapitalMoveRepository;
}

describe("capital manager CCTP starvation messaging", () => {
  it("returns awaiting_cctp_rebalance when Sepolia low and Base flush", () => {
    const manager = createCapitalManager({
      config: policy(),
      deskWalletAddress: "0x1111111111111111111111111111111111111111",
      treasuryAddress: "0x2222222222222222222222222222222222222222",
      capitalMoves: mockCapitalMoves(),
    });

    const decision = manager.decide({
      treasuryUsdc: 5, // below reserve(10)+chunk(10)
      treasurySafetyBufferEth: 0.01,
      usdcOperatingReserve: 10,
      deskEquityUsdc: 10, // needs top-up
      freeUsdcOnDesk: 10,
      lastTopupAtMs: null,
      deskPaused: false,
      killSwitchArmed: false,
      treasuryBaseUsdc: 100,
      cctpBaseSafetyBufferUsdc: 5,
      cctpRebalanceThresholdUsdc: 10,
    });

    expect(decision.action).toBe("none");
    expect(decision.reason).toBe("awaiting_cctp_rebalance");
  });

  it("keeps treasury_usdc_below_reserve_plus_chunk when Base is not flush", () => {
    const manager = createCapitalManager({
      config: policy(),
      deskWalletAddress: "0x1111111111111111111111111111111111111111",
      treasuryAddress: "0x2222222222222222222222222222222222222222",
      capitalMoves: mockCapitalMoves(),
    });

    const decision = manager.decide({
      treasuryUsdc: 5,
      treasurySafetyBufferEth: 0.01,
      usdcOperatingReserve: 10,
      deskEquityUsdc: 10,
      freeUsdcOnDesk: 10,
      lastTopupAtMs: null,
      deskPaused: false,
      killSwitchArmed: false,
      treasuryBaseUsdc: 8, // surplus 3 < threshold
      cctpBaseSafetyBufferUsdc: 5,
      cctpRebalanceThresholdUsdc: 10,
    });

    expect(decision.action).toBe("none");
    expect(decision.reason).toBe("treasury_usdc_below_reserve_plus_chunk");
  });
});
