import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeskScheduler } from "../desk/desk-scheduler.ts";
import type { DeskControlPlane } from "../desk/control-plane.ts";

function mockControlPlane(
  overrides: Partial<DeskControlPlane> = {},
): DeskControlPlane {
  return {
    async runCapitalTick() {
      return {
        mark: {
          asOf: new Date().toISOString(),
          deskAddress: "0xdesk",
          usdc: 11,
          weth: 0,
          link: 0,
          equityUsdc: 11,
          aave: {
            totalCollateralUsd: 0,
            totalDebtUsd: 0,
            availableBorrowsUsd: 0,
            currentLiquidationThreshold: 0,
            ltv: 0,
            healthFactor: null,
          },
        },
        treasuryUsdc: 40,
        treasuryEth: 0.2,
        capital: {
          decision: { action: "none", amountUsdc: 0, reason: "at_target" },
        },
      };
    },
    async runDeskTick() {
      return {
        heartbeat: {
          id: "hb-1",
          source: "scheduler",
          created_at: new Date().toISOString(),
        },
        mark: null,
        evaluations: [],
        executions: [],
      };
    },
    async runAgentOnly() {
      return {
        proposal: {
          version: 1 as const,
          action: "hold" as const,
          strategy: null,
          notionalUsdc: 0,
          priority: 0,
          confidence: 0,
          thesis: "test hold",
          riskNotes: [],
          legsHint: ["none" as const],
          declineReasons: [],
        },
        agentRunId: null,
        context: {} as never,
        safeDefault: true,
      };
    },
    async applyExecutionResult() {
      throw new Error("not used");
    },
    async armKill() {
      throw new Error("not used");
    },
    async getStatus() {
      throw new Error("not used");
    },
    async getLatestAgent() {
      return null;
    },
    async getLatestPosition() {
      return null;
    },
    async markLive() {
      throw new Error("not used");
    },
    async listIntents() {
      return [];
    },
    async listIntentsPage(params) {
      const page = params?.page ?? 1;
      const limit = params?.limit ?? 20;
      return {
        items: [],
        page,
        limit,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      };
    },
    async listTickets() {
      return [];
    },
    async listTicketsPage(params) {
      const page = params?.page ?? 1;
      const limit = params?.limit ?? 15;
      return {
        items: [],
        page,
        limit,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      };
    },
    async getTicket() {
      return null;
    },
    async findTicketBySignalHash() {
      return null;
    },
    async findTicketByIntentId() {
      return null;
    },
    async listCapitalMoves() {
      return [];
    },
    async listCapitalMovesPage(params) {
      const page = params?.page ?? 1;
      const limit = params?.limit ?? 15;
      return {
        items: [],
        page,
        limit,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      };
    },
    getKillState() {
      return {
        armed: false,
        armedAt: null,
        armedReason: null,
        lastTripAt: null,
        lastTripReason: null,
        lastKeeperHubRunId: null,
        lastTxHash: null,
      };
    },
    getConfig() {
      throw new Error("not used");
    },
    getDeskWalletAddress() {
      return "0xdesk";
    },
    getTreasuryWalletAddress() {
      return "0xtreasury";
    },
    isAgentEnabled() {
      return true;
    },
    getAgentBlockedReason() {
      return null;
    },
    ...overrides,
  };
}

describe("createDeskScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs capital then strategy tick with execute + scheduler source", async () => {
    const runCapitalTick = vi.fn().mockResolvedValue({
      mark: null,
      treasuryUsdc: 40,
      treasuryEth: 0.2,
      capital: {
        decision: { action: "topup", amountUsdc: 10, reason: "desk_below_min_aum" },
        txHash: "0xtopup",
      },
      txHash: "0xtopup",
    });
    const runDeskTick = vi.fn().mockResolvedValue({
      heartbeat: { id: "hb", source: "scheduler", created_at: new Date().toISOString() },
      mark: null,
      evaluations: [
        {
          signalId: "s1",
          signalType: "oracle_basis",
          strategy: "oracle_amm",
          planAction: "propose",
          reasonCodes: ["basis_dislocation"],
        },
      ],
      executions: [],
      agentProposal: {
        version: 1,
        action: "propose",
        strategy: "oracle_amm",
        notionalUsdc: 5,
        priority: 0.6,
        confidence: 0.7,
        thesis: "basis",
        riskNotes: [],
        legsHint: ["usdc_to_weth"],
        declineReasons: [],
      },
    });

    const logs: string[] = [];
    const scheduler = createDeskScheduler({
      controlPlane: mockControlPlane({ runCapitalTick, runDeskTick }),
      intervalMs: 60_000,
      execute: true,
      log: {
        info: (m) => logs.push(m),
        warn: (m) => logs.push(m),
        error: (m) => logs.push(m),
      },
    });

    await scheduler.tick();

    expect(runCapitalTick).toHaveBeenCalledOnce();
    expect(runDeskTick).toHaveBeenCalledWith({
      source: "scheduler",
      execute: true,
      evaluateKill: true,
    });
    expect(logs.some((l) => l.includes("capital action=topup"))).toBe(true);
    expect(logs.some((l) => l.includes("strategy execute=true"))).toBe(true);
    expect(logs.some((l) => l.includes("agent=propose"))).toBe(true);
  });

  it("runs CCTP cycle before capital and strategy when cctp worker is wired", async () => {
    const order: string[] = [];
    const cctpCycle = vi.fn().mockImplementation(async () => {
      order.push("cctp");
      return { resume: { processed: 0, results: [] }, tick: { outcome: "skipped" } };
    });
    const runCapitalTick = vi.fn().mockImplementation(async () => {
      order.push("capital");
      return {
        mark: null,
        treasuryUsdc: 40,
        treasuryEth: 0.2,
        capital: {
          decision: { action: "none", amountUsdc: 0, reason: "at_target" },
        },
      };
    });
    const runDeskTick = vi.fn().mockImplementation(async () => {
      order.push("strategy");
      return {
        heartbeat: {
          id: "hb",
          source: "scheduler",
          created_at: new Date().toISOString(),
        },
        mark: null,
        evaluations: [],
        executions: [],
      };
    });

    const scheduler = createDeskScheduler({
      controlPlane: mockControlPlane({ runCapitalTick, runDeskTick }),
      intervalMs: 60_000,
      execute: true,
      cctp: { cycle: cctpCycle },
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });

    await scheduler.tick();

    expect(order).toEqual(["cctp", "capital", "strategy"]);
    expect(cctpCycle).toHaveBeenCalledOnce();
  });

  it("still runs capital when CCTP cycle throws", async () => {
    const runCapitalTick = vi.fn().mockResolvedValue({
      mark: null,
      treasuryUsdc: 1,
      treasuryEth: 0,
      capital: {
        decision: { action: "none", amountUsdc: 0, reason: "ok" },
      },
    });
    const runDeskTick = vi.fn().mockResolvedValue({
      heartbeat: {
        id: "hb",
        source: "scheduler",
        created_at: new Date().toISOString(),
      },
      mark: null,
      evaluations: [],
      executions: [],
    });

    const scheduler = createDeskScheduler({
      controlPlane: mockControlPlane({ runCapitalTick, runDeskTick }),
      intervalMs: 60_000,
      execute: false,
      cctp: {
        cycle: async () => {
          throw new Error("iris 429");
        },
      },
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });

    await scheduler.tick();
    expect(runCapitalTick).toHaveBeenCalledOnce();
    expect(runDeskTick).toHaveBeenCalledOnce();
  });

  it("warns fail-closed when agent is not ready but still runs desk tick", async () => {
    const runCapitalTick = vi.fn().mockResolvedValue({
      mark: null,
      treasuryUsdc: 40,
      treasuryEth: 0.2,
      capital: {
        decision: { action: "none", amountUsdc: 0, reason: "at_target" },
      },
    });
    const runDeskTick = vi.fn().mockResolvedValue({
      heartbeat: { id: "hb", source: "scheduler", created_at: new Date().toISOString() },
      mark: null,
      evaluations: [],
      executions: [],
      agentProposal: {
        version: 1,
        action: "hold",
        strategy: null,
        notionalUsdc: 0,
        priority: 0,
        confidence: 0,
        thesis: "fail closed",
        riskNotes: [],
        legsHint: ["none"],
        declineReasons: ["no_llm_provider_configured"],
      },
      agentSkippedRisk: true,
    });

    const logs: string[] = [];
    const scheduler = createDeskScheduler({
      controlPlane: mockControlPlane({
        runCapitalTick,
        runDeskTick,
        isAgentEnabled: () => false,
        getAgentBlockedReason: () => "no_llm_provider_configured",
      }),
      intervalMs: 60_000,
      execute: true,
      log: {
        info: (m) => logs.push(m),
        warn: (m) => logs.push(m),
        error: (m) => logs.push(m),
      },
    });

    await scheduler.tick();

    expect(runDeskTick).toHaveBeenCalledWith({
      source: "scheduler",
      execute: true,
      evaluateKill: true,
    });
    expect(logs.some((l) => l.includes("fail-closed") && l.includes("no_llm_provider_configured"))).toBe(
      true,
    );
  });

  it("still runs strategy tick when capital throws", async () => {
    const runCapitalTick = vi.fn().mockRejectedValue(new Error("para down"));
    const runDeskTick = vi.fn().mockResolvedValue({
      heartbeat: { id: "hb", source: "scheduler", created_at: new Date().toISOString() },
      mark: null,
      evaluations: [],
      executions: [],
    });

    const scheduler = createDeskScheduler({
      controlPlane: mockControlPlane({ runCapitalTick, runDeskTick }),
      intervalMs: 60_000,
      execute: false,
      log: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });

    await scheduler.tick();

    expect(runDeskTick).toHaveBeenCalledWith({
      source: "scheduler",
      execute: false,
      evaluateKill: true,
    });
  });

  it("skips overlapping ticks while in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runCapitalTick = vi.fn().mockImplementation(async () => {
      await gate;
      return {
        mark: null,
        treasuryUsdc: 1,
        treasuryEth: 0,
        capital: { decision: { action: "none", amountUsdc: 0, reason: "ok" } },
      };
    });
    const runDeskTick = vi.fn().mockResolvedValue({
      heartbeat: { id: "hb", source: "scheduler", created_at: new Date().toISOString() },
      mark: null,
      evaluations: [],
      executions: [],
    });

    const scheduler = createDeskScheduler({
      controlPlane: mockControlPlane({ runCapitalTick, runDeskTick }),
      intervalMs: 60_000,
      execute: true,
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });

    const first = scheduler.tick();
    // Second tick while first is gated must no-op
    await scheduler.tick();
    expect(runCapitalTick).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(runDeskTick).toHaveBeenCalledTimes(1);
  });

  it("start is no-op when enabled=false", async () => {
    const runCapitalTick = vi.fn();
    const scheduler = createDeskScheduler({
      controlPlane: mockControlPlane({ runCapitalTick }),
      intervalMs: 10,
      execute: true,
      enabled: false,
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    scheduler.start();
    await new Promise((r) => setTimeout(r, 30));
    expect(runCapitalTick).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it("start fires an immediate tick and can be stopped", async () => {
    vi.useFakeTimers();
    const runCapitalTick = vi.fn().mockResolvedValue({
      mark: null,
      treasuryUsdc: 1,
      treasuryEth: 0,
      capital: { decision: { action: "none", amountUsdc: 0, reason: "ok" } },
    });
    const runDeskTick = vi.fn().mockResolvedValue({
      heartbeat: { id: "hb", source: "scheduler", created_at: new Date().toISOString() },
      mark: null,
      evaluations: [],
      executions: [],
    });

    const scheduler = createDeskScheduler({
      controlPlane: mockControlPlane({ runCapitalTick, runDeskTick }),
      intervalMs: 15_000,
      execute: true,
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(runCapitalTick).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(runCapitalTick).toHaveBeenCalledTimes(2);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(runCapitalTick).toHaveBeenCalledTimes(2);
  });
});
