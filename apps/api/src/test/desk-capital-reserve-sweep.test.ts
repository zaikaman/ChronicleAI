/**
 * Non-emergency sweeps must be reserve-capped at dispatch time against the
 * live on-chain USDC balance: cap to `free - minFreeUsdc`, skip entirely when
 * `free < minFreeUsdc`. Regression for a sweep that tried to move 10.538878
 * USDC while the desk only held 5.538878 on-chain.
 */
import { describe, expect, it, vi } from "vitest";
import { createCapitalManager } from "../desk/capital-manager.ts";
import type { ExecutionBridge } from "../desk/execution-bridge.ts";
import type { DeskPolicyConfig } from "../desk/types.ts";

function policy(overrides: Partial<DeskPolicyConfig> = {}): DeskPolicyConfig {
  return {
    targetAumUsdc: 50,
    maxAumUsdc: 100,
    minAumUsdc: 20,
    topupChunkUsdc: 10,
    minFreeUsdc: 10,
    inventoryTopupUsdc: 10,
    preferUnwindForFreeUsdc: true,
    profitSweepUsdc: 20,
    topupCooldownMs: 0,
    postMaintenanceSweepCooldownMs: 0,
    hfWarn: 1.2,
    hfCritical: 1.05,
    basisBps: 30,
    apyDeltaBps: 50,
    maxTradeUsdc: 25,
    killHeartbeatMs: 60_000,
    failedRunCooldownMs: 0,
    oracleMaxStalenessMs: 60_000,
    apyConsecutivePolls: 2,
    apyAbsurdBps: 5000,
    rebalanceIntervalMs: 0,
    maintenanceNotionalUsdc: 10,
    gasElevatedGwei: 50,
    eventMicrotradeEnabled: false,
    eventMicrotradeUsdc: 5,
    eventMicrotradeCooldownMs: 0,
    eventMicrotradeLookbackMs: 0,
    paused: false,
    ...overrides,
  };
}

function mockCapitalMoves() {
  return {
    create: vi.fn().mockImplementation(async (row: Record<string, unknown>) => ({
      ok: true as const,
      value: {
        id: "move-1",
        created_at: new Date().toISOString(),
        ...row,
      },
    })),
    update: vi.fn().mockResolvedValue({ ok: true, value: { id: "move-1" } }),
    findById: vi.fn().mockResolvedValue({ ok: true, value: null }),
    findLatestByDirection: vi.fn().mockResolvedValue({ ok: true, value: null }),
    listRecent: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    listPage: vi.fn().mockResolvedValue({ ok: true, value: { data: [], count: 0 } }),
    listByDirection: vi.fn().mockResolvedValue({ ok: true, value: [] }),
  };
}

function makeBridge() {
  const execute = vi.fn().mockResolvedValue({
    keeperHubRunId: "run-sweep-1",
    txHash: "0xabc123def456",
    explorerUrl: "https://sepolia.etherscan.io/tx/0xabc123def456",
    status: "completed",
    success: true,
  });
  const bridge: ExecutionBridge = {
    execute,
    actionForStrategy: () => "sweep",
    requireWorkflowId: () => "wf-sweep",
    isConfigured: (action) => action === "sweep" || action === undefined,
  };
  return { bridge, execute };
}

function makeManager(options: {
  readDeskUsdcBalance?: (() => Promise<number | null>) | null;
  minFreeUsdc?: number;
}) {
  const { bridge, execute } = makeBridge();
  const manager = createCapitalManager({
    config: policy({ minFreeUsdc: options.minFreeUsdc ?? 10 }),
    deskWalletAddress: "0x1111111111111111111111111111111111111111",
    treasuryAddress: "0x2222222222222222222222222222222222222222",
    capitalMoves: mockCapitalMoves(),
    executionBridge: bridge,
    readDeskUsdcBalance: options.readDeskUsdcBalance,
  });
  return { manager, bridge, execute };
}

describe("executeSweep live reserve guard", () => {
  it("caps a non-emergency sweep to live free minus minFree when balance is stale", async () => {
    const { manager, execute } = makeManager({
      // Decision mark said 30 free; on-chain reality is only 12.
      readDeskUsdcBalance: async () => 12,
    });

    const result = await manager.executeSweep(
      30,
      "desk_equity_above_max_aum",
      false,
    );

    expect(result.decision.action).toBe("sweep");
    expect(result.decision.amountUsdc).toBe(2);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0]).toBe("sweep");
    const input = execute.mock.calls[0]![1] as Record<string, unknown>;
    expect(input.amountUsdc).toBe(2);
    expect(input.amount).toBe("2");
  });

  it("skips a non-emergency sweep entirely when live free is below minFree", async () => {
    const { manager, execute } = makeManager({
      readDeskUsdcBalance: async () => 5.538878,
    });

    const result = await manager.executeSweep(
      10.538878,
      "desk_equity_above_max_aum",
      false,
    );

    expect(result.decision.action).toBe("none");
    expect(result.decision.amountUsdc).toBe(0);
    expect(result.decision.reason).toBe("free_usdc_below_min_reserve");
    expect(execute).not.toHaveBeenCalled();
  });

  it("skips when the live free minus reserve is below sweep dust", async () => {
    const { manager, execute } = makeManager({
      readDeskUsdcBalance: async () => 10.005,
    });

    const result = await manager.executeSweep(
      30,
      "desk_equity_above_max_aum",
      false,
    );

    expect(result.decision.action).toBe("none");
    expect(result.decision.amountUsdc).toBe(0);
    expect(result.decision.reason).toBe("free_usdc_reserved_for_powder");
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not cap when the live free supports the requested amount", async () => {
    const { manager, execute } = makeManager({
      readDeskUsdcBalance: async () => 40,
    });

    const result = await manager.executeSweep(
      30,
      "desk_equity_above_max_aum",
      false,
    );

    expect(result.decision.action).toBe("sweep");
    expect(result.decision.amountUsdc).toBe(30);
    const input = execute.mock.calls[0]![1] as Record<string, unknown>;
    expect(input.amountUsdc).toBe(30);
  });

  it("lets emergency sweeps take the full free balance including powder", async () => {
    const { manager, execute } = makeManager({
      readDeskUsdcBalance: async () => 5.538878,
    });

    const result = await manager.executeSweep(
      5.538878,
      "kill_switch_emergency_return",
      true,
    );

    expect(result.decision.action).toBe("emergency_return");
    expect(result.decision.amountUsdc).toBeCloseTo(5.538878, 6);
    expect(execute).toHaveBeenCalledTimes(1);
    const input = execute.mock.calls[0]![1] as Record<string, unknown>;
    expect(input.amountUsdc).toBeCloseTo(5.538878, 6);
  });

  it("does not apply the guard when no live balance reader is wired", async () => {
    const { manager, execute } = makeManager({ readDeskUsdcBalance: null });

    const result = await manager.executeSweep(
      30,
      "desk_equity_above_max_aum",
      false,
    );

    expect(result.decision.action).toBe("sweep");
    expect(result.decision.amountUsdc).toBe(30);
    const input = execute.mock.calls[0]![1] as Record<string, unknown>;
    expect(input.amountUsdc).toBe(30);
  });
});
