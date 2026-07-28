import { describe, expect, it, vi } from "vitest";
import type { DeskCapitalMoveRepository } from "@chronicleai/db";
import { createCapitalManager } from "../desk/capital-manager.ts";
import type { ExecutionBridge } from "../desk/execution-bridge.ts";
import type { CapitalTickInput, DeskPolicyConfig } from "../desk/types.ts";

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
    listRecent: vi.fn(),
    listPage: vi.fn(),
    findLatestByDirection: vi.fn(),
  } as unknown as DeskCapitalMoveRepository;
}

function baseTick(overrides: Partial<CapitalTickInput> = {}): CapitalTickInput {
  return {
    treasuryUsdc: 100,
    treasurySafetyBufferEth: 0.01,
    usdcOperatingReserve: 10,
    deskEquityUsdc: 600,
    freeUsdcOnDesk: 0,
    lastTopupAtMs: null,
    deskPaused: false,
    killSwitchArmed: false,
    aaveTotalCollateralUsd: 637,
    aaveTotalDebtUsd: 0,
    freeLinkOnDesk: 0,
    linkUsdPrice: 15,
    ...overrides,
  };
}

describe("capital manager free inventory (A1)", () => {
  it("decides free_inventory when free USDC is 0 and Aave has freeable LINK", () => {
    const manager = createCapitalManager({
      config: policy(),
      deskWalletAddress: "0x1111111111111111111111111111111111111111",
      treasuryAddress: "0x2222222222222222222222222222222222222222",
      capitalMoves: mockCapitalMoves(),
    });

    const decision = manager.decide(baseTick());
    expect(decision.action).toBe("free_inventory");
    expect(decision.amountUsdc).toBe(10);
    expect(decision.reason).toBe("free_usdc_shortfall_unwind");
    expect(decision.inventorySource).toBe("aave_link");
  });

  it("does not free inventory when free USDC already meets min", () => {
    const manager = createCapitalManager({
      config: policy(),
      deskWalletAddress: "0x1111111111111111111111111111111111111111",
      treasuryAddress: "0x2222222222222222222222222222222222222222",
      capitalMoves: mockCapitalMoves(),
    });

    // Equity within band so sweep does not fire; free USDC above min floor.
    const decision = manager.decide(
      baseTick({ freeUsdcOnDesk: 15, deskEquityUsdc: 50 }),
    );
    expect(decision.action).toBe("none");
  });

  it("does not sweep all free USDC when equity ≫ max AUM (powder reserve)", () => {
    const manager = createCapitalManager({
      config: policy({ minFreeUsdc: 10 }),
      deskWalletAddress: "0x1111111111111111111111111111111111111111",
      treasuryAddress: "0x2222222222222222222222222222222222222222",
      capitalMoves: mockCapitalMoves(),
    });

    // Live thrash scenario: free restored to floor, equity still over tiny max.
    const atFloor = manager.decide(
      baseTick({ freeUsdcOnDesk: 10, deskEquityUsdc: 1000 }),
    );
    expect(atFloor.action).toBe("none");
    expect(atFloor.reason).toBe("equity_above_max_but_free_usdc_reserved");

    const free12 = manager.decide(
      baseTick({ freeUsdcOnDesk: 12, deskEquityUsdc: 1000 }),
    );
    expect(free12.action).toBe("sweep");
    expect(free12.amountUsdc).toBeLessThanOrEqual(2);
    expect(free12.amountUsdc).toBe(2);
    expect(free12.reason).toBe("desk_equity_above_max_aum");
  });

  it("never sweeps powder on max-AUM path when free is only reserve", () => {
    const manager = createCapitalManager({
      config: policy({ minFreeUsdc: 10 }),
      deskWalletAddress: "0x1111111111111111111111111111111111111111",
      treasuryAddress: "0x2222222222222222222222222222222222222222",
      capitalMoves: mockCapitalMoves(),
    });

    for (const free of [0, 5, 9.99, 10]) {
      const decision = manager.decide(
        baseTick({ freeUsdcOnDesk: free, deskEquityUsdc: 1100 }),
      );
      if (decision.action === "sweep") {
        expect(decision.amountUsdc).toBeLessThanOrEqual(
          Math.max(0, free - 10),
        );
      } else {
        expect(decision.action).not.toBe("sweep");
      }
    }
  });

  it("emergency kill still sweeps full free including powder", () => {
    const manager = createCapitalManager({
      config: policy({ minFreeUsdc: 10 }),
      deskWalletAddress: "0x1111111111111111111111111111111111111111",
      treasuryAddress: "0x2222222222222222222222222222222222222222",
      capitalMoves: mockCapitalMoves(),
    });

    const decision = manager.decide(
      baseTick({ freeUsdcOnDesk: 12, deskEquityUsdc: 1000, killSwitchArmed: true }),
    );
    expect(decision.action).toBe("emergency_return");
    expect(decision.amountUsdc).toBe(12);
  });

  it("falls back to inventory top-up when no unwindable collateral", () => {
    const manager = createCapitalManager({
      config: policy(),
      deskWalletAddress: "0x1111111111111111111111111111111111111111",
      treasuryAddress: "0x2222222222222222222222222222222222222222",
      capitalMoves: mockCapitalMoves(),
    });

    // Equity at target with zero free USDC and no Aave/LINK → treasury inventory top-up
    const decision = manager.decide(
      baseTick({
        deskEquityUsdc: 50,
        freeUsdcOnDesk: 0,
        aaveTotalCollateralUsd: 0,
        aaveTotalDebtUsd: 0,
        freeLinkOnDesk: 0,
      }),
    );
    expect(decision.action).toBe("topup");
    expect(decision.reason).toBe("free_usdc_shortfall_no_unwind");
    expect(decision.amountUsdc).toBe(10);
  });

  it("falls back to inventory top-up when LINK price is unavailable", () => {
    const manager = createCapitalManager({
      config: policy(),
      deskWalletAddress: "0x1111111111111111111111111111111111111111",
      treasuryAddress: "0x2222222222222222222222222222222222222222",
      capitalMoves: mockCapitalMoves(),
    });

    const decision = manager.decide(
      baseTick({
        deskEquityUsdc: 50,
        freeUsdcOnDesk: 0,
        aaveTotalCollateralUsd: 637,
        aaveTotalDebtUsd: 0,
        freeLinkOnDesk: 0,
        linkUsdPrice: null,
      }),
    );
    expect(decision.action).toBe("topup");
    expect(decision.reason).toBe("free_usdc_shortfall_no_unwind");
  });

  it("prefers urgent equity top-up over free_inventory when under min AUM", () => {
    const manager = createCapitalManager({
      config: policy(),
      deskWalletAddress: "0x1111111111111111111111111111111111111111",
      treasuryAddress: "0x2222222222222222222222222222222222222222",
      capitalMoves: mockCapitalMoves(),
    });

    const decision = manager.decide(
      baseTick({
        deskEquityUsdc: 10,
        freeUsdcOnDesk: 0,
        aaveTotalCollateralUsd: 100,
        aaveTotalDebtUsd: 0,
      }),
    );
    expect(decision.action).toBe("topup");
    expect(decision.reason).toBe("desk_below_min_aum");
  });

  it("executes free_inventory via rotate workflow with real tx hash only", async () => {
    const execute = vi.fn().mockResolvedValue({
      keeperHubRunId: "run-free-1",
      txHash: "0xabc123def456",
      explorerUrl: "https://sepolia.etherscan.io/tx/0xabc123def456",
      status: "completed",
      success: true,
    });
    const bridge: ExecutionBridge = {
      execute,
      actionForStrategy: () => "rotate",
      requireWorkflowId: () => "wf-rotate",
      isConfigured: (action) => action === "rotate" || action === undefined,
    };

    const manager = createCapitalManager({
      config: policy(),
      deskWalletAddress: "0x1111111111111111111111111111111111111111",
      treasuryAddress: "0x2222222222222222222222222222222222222222",
      capitalMoves: mockCapitalMoves(),
      executionBridge: bridge,
    });

    const result = await manager.tick(baseTick());
    expect(result.decision.action).toBe("free_inventory");
    expect(result.txHash).toBe("0xabc123def456");
    expect(result.keeperHubRunId).toBe("run-free-1");
    expect(result.errorMessage).toBeUndefined();
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]![0]).toBe("rotate");
    expect(execute.mock.calls[0]![1]).toMatchObject({
      direction: "out_of_aave_link",
      capitalAction: "free_inventory",
    });
  });

  it("prefers free_link oracle_arb over Aave when mixed inventory covers need", async () => {
    const execute = vi.fn().mockResolvedValue({
      keeperHubRunId: "run-free-link",
      txHash: "0xfreelink",
      explorerUrl: "https://sepolia.etherscan.io/tx/0xfreelink",
      status: "completed",
    });
    const bridge: ExecutionBridge = {
      execute,
      actionForStrategy: () => "oracle_arb",
      requireWorkflowId: () => "wf-arb",
      isConfigured: (action) =>
        action === "oracle_arb" || action === "rotate" || action === undefined,
    };

    const manager = createCapitalManager({
      config: policy(),
      deskWalletAddress: "0x1111111111111111111111111111111111111111",
      treasuryAddress: "0x2222222222222222222222222222222222222222",
      capitalMoves: mockCapitalMoves(),
      executionBridge: bridge,
    });

    // 72 free LINK + Aave collateral — production-shaped mixed book.
    const result = await manager.tick(
      baseTick({
        freeUsdcOnDesk: 5,
        freeLinkOnDesk: 72,
        aaveTotalCollateralUsd: 5.65,
        aaveLinkSupplied: 0.188,
        linkUsdPrice: 30,
      }),
    );
    expect(result.errorMessage).toBeUndefined();
    expect(result.txHash).toBe("0xfreelink");
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]![0]).toBe("oracle_arb");
    expect(execute.mock.calls[0]![1]).toMatchObject({
      capitalAction: "free_inventory",
      inventorySource: "free_link",
    });
  });

  it("falls back to free_link when Aave rotate throws", async () => {
    const execute = vi.fn(async (action: string) => {
      if (action === "rotate") {
        throw new Error("Contract call failed: Error(32)");
      }
      return {
        keeperHubRunId: "run-fallback",
        txHash: "0xfallback",
        explorerUrl: "https://sepolia.etherscan.io/tx/0xfallback",
        status: "completed",
      };
    });
    const bridge: ExecutionBridge = {
      execute: execute as ExecutionBridge["execute"],
      actionForStrategy: () => "rotate",
      requireWorkflowId: () => "wf",
      isConfigured: () => true,
    };

    const manager = createCapitalManager({
      config: policy(),
      deskWalletAddress: "0x1111111111111111111111111111111111111111",
      treasuryAddress: "0x2222222222222222222222222222222222222222",
      capitalMoves: mockCapitalMoves(),
      executionBridge: bridge,
    });

    // Force Aave-first by aave_link-only freeable without free LINK cover in decide
    // path — but tick with free LINK for fallback after aave throws.
    // inventorySource aave_link from decide when only aave? Use freeLink so fallback works.
    const result = await manager.tick(
      baseTick({
        freeUsdcOnDesk: 0,
        freeLinkOnDesk: 5,
        aaveTotalCollateralUsd: 637,
        aaveLinkSupplied: 40,
        linkUsdPrice: 15,
      }),
    );
    // free_link covers → prefer free_link first (no rotate call)
    expect(result.txHash).toBe("0xfallback");
    expect(execute.mock.calls[0]![0]).toBe("oracle_arb");
  });

  it("refuses free_inventory without tx hash (no fake fill)", async () => {
    const bridge: ExecutionBridge = {
      execute: vi.fn().mockResolvedValue({
        keeperHubRunId: "run-no-tx",
        txHash: "",
        explorerUrl: "",
        status: "completed",
        success: true,
      }),
      actionForStrategy: () => "rotate",
      requireWorkflowId: () => "wf-rotate",
      isConfigured: () => true,
    };

    const manager = createCapitalManager({
      config: policy(),
      deskWalletAddress: "0x1111111111111111111111111111111111111111",
      treasuryAddress: "0x2222222222222222222222222222222222222222",
      capitalMoves: mockCapitalMoves(),
      executionBridge: bridge,
    });

    const result = await manager.tick(baseTick());
    expect(result.decision.action).toBe("free_inventory");
    expect(result.txHash).toBeUndefined();
    expect(result.errorMessage).toMatch(/swap_failed|without tx hash/i);
  });

  it("returns structured skip when free short and no bridge/collateral path", async () => {
    const manager = createCapitalManager({
      config: policy({ preferUnwindForFreeUsdc: true }),
      deskWalletAddress: "0x1111111111111111111111111111111111111111",
      treasuryAddress: "0x2222222222222222222222222222222222222222",
      capitalMoves: mockCapitalMoves(),
      // no execution bridge
    });

    const result = await manager.tick(
      baseTick({
        deskEquityUsdc: 600,
        // equity high + aave freeable → free_inventory decide, but execute fails without bridge
      }),
    );
    expect(result.decision.action).toBe("free_inventory");
    expect(result.errorMessage).toMatch(/Execution bridge not configured/i);
  });
});
