import { describe, expect, it, vi } from "vitest";
import {
  createDeskControlPlane,
  normalizePublicHealthFactor,
  strategyForSignalType,
  toPremiumIntent,
  toPublicIntent,
  toPublicTicket,
  toPublicTicketNarrative,
} from "../desk/control-plane.ts";
import {
  buildExecutionAudit,
  buildOutcomeStage,
  buildPreflightStage,
  buildSubmitStage,
} from "../desk/execution-audit.ts";
import type { DeskPolicyConfig } from "../desk/types.ts";
import type {
  DeskAgentRunRepository,
  DeskAgentRunRow,
  DeskCapitalMoveRepository,
  DeskCapitalMoveRow,
  DeskHeartbeatRow,
  DeskIntentRow,
  DeskSignalRepository,
  DeskSignalRow,
  DeskTicketRow,
  ExecutionLogInsert,
  ExecutionLogRepository,
} from "@chronicleai/db";
import { DESK_CHAIN_ID } from "@chronicleai/schemas";
import type { HeartbeatService } from "../desk/heartbeat-service.ts";
import type { IntentService } from "../desk/intent-service.ts";
import type { KillSwitchService } from "../desk/kill-switch-service.ts";
import type { TicketService } from "../desk/ticket-service.ts";
import type { StrategyRunner } from "../desk/strategy-runner.ts";
import type { CapitalManager } from "../desk/capital-manager.ts";

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

function sampleIntent(overrides: Partial<DeskIntentRow> = {}): DeskIntentRow {
  return {
    id: "intent-1",
    signal_id: "sig-1",
    strategy: "risk_defend",
    status: "proposed",
    notional_usdc: 10,
    legs: [{ protocol: "aave-v3", action: "repay" }],
    reason_codes: ["hf_critical"],
    policy_snapshot: { maxTradeUsdc: 15 },
    keeper_hub_run_id: null,
    error_message: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function sampleTicket(overrides: Partial<DeskTicketRow> = {}): DeskTicketRow {
  return {
    id: "ticket-1",
    intent_id: "intent-1",
    ticket_hash: "0xabc",
    signal_hash: "0xsig",
    intent_hash: "0xint",
    content_uri: "https://example.com/desk/tickets/ticket-1",
    tx_hash: "0xtx",
    keeper_hub_run_id: "run-1",
    explorer_url: "https://sepolia.etherscan.io/tx/0xtx",
    summary: "Desk risk_defend",
    payload: { version: 1, legs: [] },
    created_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("strategyForSignalType", () => {
  it("maps desk signal types to strategies", () => {
    expect(strategyForSignalType("health_factor")).toBe("risk_defend");
    expect(strategyForSignalType("liquidation_cluster")).toBe("risk_defend");
    expect(strategyForSignalType("apy_delta")).toBe("yield_rotation");
    expect(strategyForSignalType("oracle_basis")).toBe("oracle_amm");
    expect(strategyForSignalType("gas_regime")).toBeNull();
  });
});

describe("public vs premium serializers", () => {
  it("strips legs from public intent summary", () => {
    const intent = sampleIntent();
    const pub = toPublicIntent(intent);
    expect(pub.legCount).toBe(1);
    expect(pub).not.toHaveProperty("legs");
    expect(pub).not.toHaveProperty("policySnapshot");
    expect(pub.agentThesis).toBeNull();

    const premium = toPremiumIntent(intent);
    expect(premium.legs).toEqual(intent.legs);
    expect(premium.policySnapshot).toEqual({ maxTradeUsdc: 15 });
  });

  it("surfaces agent thesis from policy_snapshot.agent", () => {
    const intent = sampleIntent({
      policy_snapshot: {
        maxTradeUsdc: 15,
        agent: {
          version: 1,
          action: "propose",
          strategy: "yield_rotation",
          notionalUsdc: 10,
          priority: 0.7,
          confidence: 0.82,
          thesis: "APY edge clears band with free USDC available.",
          riskNotes: [],
          legsHint: ["usdc_to_link"],
          declineReasons: [],
        },
      },
    });
    const pub = toPublicIntent(intent);
    expect(pub.agentAction).toBe("propose");
    expect(pub.agentConfidence).toBe(0.82);
    expect(pub.agentThesis).toContain("APY edge");
  });

  it("exposes proof fields on public ticket without payload", () => {
    const ticket = sampleTicket();
    const pub = toPublicTicket(ticket);
    expect(pub.ticketHash).toBe("0xabc");
    expect(pub.txHash).toBe("0xtx");
    expect(pub).not.toHaveProperty("payload");
  });

  it("toPublicTicketNarrative maps payload.executionAudit to public fields", () => {
    const audit = buildExecutionAudit({
      preflight: buildPreflightStage({
        at: "2026-07-28T12:00:00.000Z",
        status: "passed",
        policy: {
          allow: true,
          reasonCodes: ["hf_ok"],
          gasRegime: "normal",
          simulatedHfAfter: 1.4,
        },
      }),
      submit: buildSubmitStage({
        at: "2026-07-28T12:00:01.000Z",
        status: "started",
        keeperHubRunId: "run_public",
        routing: "private_mempool",
      }),
      outcome: buildOutcomeStage({
        at: "2026-07-28T12:00:08.000Z",
        status: "filled",
        txHashes: ["0xdeadbeef"],
        gasUsed: "61234",
        gasUsedWei: "1000",
      }),
    });
    const ticket = sampleTicket({
      payload: {
        version: 1,
        strategy: "risk_defend",
        notionalUsdc: 25,
        signal: { type: "health_factor", features: {} },
        legs: [{ protocol: "aave-v3", action: "repay" }],
        fills: [{ txHash: "0xdeadbeef", step: 0 }],
        policy: { reasonCodes: ["hf_ok"], routing: "private_mempool" },
        executionAudit: audit,
      },
    });
    const narrative = toPublicTicketNarrative(ticket);
    expect(narrative.executionAudit?.version).toBe(1);
    expect(narrative.executionAudit?.stages.preflight.status).toBe("passed");
    expect(narrative.executionAudit?.stages.submit.keeperHubRunId).toBe(
      "run_public",
    );
    expect(narrative.executionAudit?.stages.outcome.txHashes).toEqual([
      "0xdeadbeef",
    ]);
    expect(narrative.executionAuditSummary).toContain("Preflight passed");
    expect(narrative.gasUsed).toBe("61234");
    expect(narrative.gasUsedWei).toBe("1000");
  });

  it("toPublicTicketNarrative leaves audit null for legacy tickets", () => {
    const ticket = sampleTicket({
      payload: {
        version: 1,
        strategy: "risk_defend",
        notionalUsdc: 10,
        signal: { type: "health_factor", features: {} },
        legs: [],
        fills: [],
        policy: {},
      },
    });
    const narrative = toPublicTicketNarrative(ticket);
    expect(narrative.executionAudit).toBeNull();
    expect(narrative.executionAuditSummary).toBeNull();
    expect(narrative.gasUsed).toBeNull();
  });
});

describe("createDeskControlPlane", () => {
  it("normalizes no-debt and legacy persisted health-factor snapshots", () => {
    expect(
      normalizePublicHealthFactor({ healthFactor: null, totalDebtUsd: 0 }),
    ).toBe(999);
    expect(normalizePublicHealthFactor({ health_factor: 1.35 })).toBe(1.35);
    expect(normalizePublicHealthFactor({ healthFactor: 1.1 })).toBe(1.1);
    expect(normalizePublicHealthFactor({})).toBeNull();
  });

  function buildPlane(opts?: {
    intents?: DeskIntentRow[];
    capitalTick?: ReturnType<CapitalManager["tick"]>;
    signals?: DeskSignalRow[];
    agentConfig?: {
      llmConfigured: boolean;
      maxSignals?: number;
      minConfidence?: number;
      forceDefendOnCriticalHf?: boolean;
    };
    agentProposalFromRun?: {
      version: 1;
      action: "hold" | "defer" | "defend" | "propose";
      strategy: "risk_defend" | "yield_rotation" | "oracle_amm" | null;
      notionalUsdc: number;
      priority: number;
      confidence: number;
      thesis: string;
      riskNotes: string[];
      legsHint: Array<
        | "none"
        | "repay_debt"
        | "withdraw_risk"
        | "usdc_to_link"
        | "link_to_usdc"
        | "aave_supply_link"
        | "aave_withdraw_link"
        | "usdc_to_weth"
        | "weth_to_usdc"
      >;
      declineReasons: string[];
    };
    evaluateAndPropose?: StrategyRunner["evaluateAndPropose"];
    /** When true, mark returns a live desk book so strategy loop runs. */
    withLiveMark?: boolean;
    agentRuns?: DeskAgentRunRepository | null;
    execLogRepo?: ExecutionLogRepository | null;
  }) {
    const intentRows = opts?.intents ?? [sampleIntent()];
    let intentStore = [...intentRows];
    const signalRows = opts?.signals ?? [];
    const evaluateCalls: Array<{ strategy: string }> = [];

    const heartbeats: HeartbeatService = {
      async touch(source) {
        return {
          id: "hb-1",
          source,
          created_at: new Date().toISOString(),
        } satisfies DeskHeartbeatRow;
      },
      async getLatest() {
        return null;
      },
      async getStatus() {
        return {
          lastSeenAt: null,
          ageMs: null,
          stale: true,
          killEligible: true,
          source: null,
        };
      },
      async prune() {
        return 0;
      },
      async isStale() {
        return true;
      },
    };

    const intents: IntentService = {
      async propose() {
        throw new Error("not used");
      },
      async findById(id) {
        return intentStore.find((i) => i.id === id) ?? null;
      },
      async listRecent() {
        return intentStore;
      },
      async listPage(params) {
        const page = params?.page ?? 1;
        const limit = params?.limit ?? 20;
        return {
          items: intentStore,
          page,
          limit,
          total: intentStore.length,
          totalPages: intentStore.length === 0 ? 0 : 1,
          hasNextPage: false,
          hasPreviousPage: false,
        };
      },
      async listOpen() {
        return intentStore.filter((i) =>
          ["proposed", "approved", "executing"].includes(i.status),
        );
      },
      async findOpenByStrategy() {
        return null;
      },
      async transition() {
        throw new Error("not used");
      },
      async approve(id) {
        return intentStore.find((i) => i.id === id)!;
      },
      async markExecuting(id, runId) {
        intentStore = intentStore.map((i) =>
          i.id === id
            ? {
                ...i,
                status: "executing" as const,
                keeper_hub_run_id: runId ?? null,
              }
            : i,
        );
        return intentStore.find((i) => i.id === id)!;
      },
      async markFilled(id, runId) {
        intentStore = intentStore.map((i) =>
          i.id === id
            ? {
                ...i,
                status: "filled" as const,
                keeper_hub_run_id: runId ?? i.keeper_hub_run_id,
              }
            : i,
        );
        return intentStore.find((i) => i.id === id)!;
      },
      async markFailed(id, errorMessage, runId) {
        intentStore = intentStore.map((i) =>
          i.id === id
            ? {
                ...i,
                status: "failed" as const,
                error_message: errorMessage,
                keeper_hub_run_id: runId ?? null,
              }
            : i,
        );
        return intentStore.find((i) => i.id === id)!;
      },
      async markDeferred(id) {
        return intentStore.find((i) => i.id === id)!;
      },
      async cancel(id) {
        return intentStore.find((i) => i.id === id)!;
      },
      async hasOpenForStrategy() {
        return false;
      },
      async hasAnyOpen() {
        return false;
      },
      isTerminal(status) {
        return ["filled", "failed", "cancelled"].includes(status);
      },
      isOpen(status) {
        return ["proposed", "approved", "executing"].includes(status);
      },
      canTransition() {
        return true;
      },
    };

    const tickets: TicketService = {
      buildCanonical() {
        throw new Error("not used");
      },
      async create() {
        throw new Error("not used");
      },
      async publish(input) {
        return {
          ticket: sampleTicket({ intent_id: input.intentId }),
          ticketHash: "0xabc",
          signalHash: "0xsig",
          intentHash: "0xint",
          contentUri: "https://example.com/t",
          summary: "test",
          registryTxHash: "0xtx",
        };
      },
      async findById(id) {
        return id === "ticket-1" ? sampleTicket() : null;
      },
      async findByIntentId() {
        return null;
      },
      async findBySignalHash() {
        return null;
      },
      async listRecent() {
        return [sampleTicket()];
      },
      async listPage(params) {
        const page = params?.page ?? 1;
        const limit = params?.limit ?? 15;
        const items = [sampleTicket()];
        return {
          items,
          page,
          limit,
          total: items.length,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        };
      },
      summarize() {
        return "summary";
      },
    };

    const capitalMoves: DeskCapitalMoveRepository = {
      async create() {
        throw new Error("not used");
      },
      async update() {
        throw new Error("not used");
      },
      async findById() {
        return { ok: true, value: null };
      },
      async findLatestByDirection() {
        return { ok: true, value: null };
      },
      async listRecent() {
        return { ok: true, value: [] as DeskCapitalMoveRow[] };
      },
      async listPage(params) {
        const page = params?.page ?? 1;
        const limit = params?.limit ?? 15;
        return {
          ok: true,
          value: {
            items: [] as DeskCapitalMoveRow[],
            page,
            limit,
            total: 0,
            totalPages: 0,
            hasNextPage: false,
            hasPreviousPage: false,
          },
        };
      },
      async listByDirection() {
        return { ok: true, value: [] };
      },
    };

    const idleKillState = {
      armed: false as boolean,
      armedAt: null as string | null,
      armedReason: null as string | null,
      lastTripAt: null as string | null,
      lastTripReason: null as string | null,
      lastKeeperHubRunId: null as string | null,
      lastTxHash: null as string | null,
    };
    const killSwitch: KillSwitchService = {
      async hydrate() {
        return { ...idleKillState };
      },
      async arm(reason) {
        return {
          armed: true,
          armedAt: new Date().toISOString(),
          armedReason: reason,
          lastTripAt: null,
          lastTripReason: null,
          lastKeeperHubRunId: null,
          lastTxHash: null,
        };
      },
      async disarm() {
        return { ...idleKillState };
      },
      isArmed: () => false,
      getState: () => ({ ...idleKillState }),
      async evaluate() {
        return {
          tripped: false,
          state: {
            armed: false,
            armedAt: null,
            armedReason: null,
            lastTripAt: null,
            lastTripReason: null,
            lastKeeperHubRunId: null,
            lastTxHash: null,
          },
        };
      },
      async trip() {
        return {
          tripped: false,
          state: {
            armed: true,
            armedAt: new Date().toISOString(),
            armedReason: "test",
            lastTripAt: null,
            lastTripReason: null,
            lastKeeperHubRunId: null,
            lastTxHash: null,
          },
          errorMessage: "no free usdc",
        };
      },
    };

    const signals: DeskSignalRepository = {
      async create() {
        throw new Error("not used");
      },
      async findById() {
        return { ok: true, value: null };
      },
      async findByDedupeKey() {
        return { ok: true, value: null };
      },
      async listRecent() {
        return { ok: true, value: signalRows };
      },
      async listByType() {
        return { ok: true, value: [] };
      },
    };

    const capitalManager: CapitalManager = {
      decide() {
        return { action: "none", amountUsdc: 0, reason: "ok" };
      },
      async tick() {
        return {
          decision: { action: "none", amountUsdc: 0, reason: "no_action" },
        };
      },
      async executeTopup() {
        throw new Error("not used");
      },
      async executeSweep() {
        throw new Error("not used");
      },
    };

    const strategyRunner: StrategyRunner = {
      plan() {
        return { action: "ignore", reasonCodes: ["noop"] };
      },
      async evaluateAndPropose(input) {
        evaluateCalls.push({ strategy: input.strategy });
        if (opts?.evaluateAndPropose) {
          return opts.evaluateAndPropose(input);
        }
        return { plan: { action: "ignore", reasonCodes: ["noop"] } };
      },
      async executeIntent() {
        throw new Error("not used");
      },
    };

    let paused = false;

    const agent =
      opts?.agentProposalFromRun != null
        ? {
            async run() {
              return {
                proposal: opts.agentProposalFromRun!,
                safeDefault: false,
                latencyMs: 1,
              };
            },
          }
        : null;

    const positions = opts?.withLiveMark
      ? ({
          async mark() {
            return {
              asOf: new Date().toISOString(),
              deskAddress: "0x1111111111111111111111111111111111111111",
              usdc: 40,
              weth: 0,
              link: 0,
              equityUsdc: 40,
              aave: {
                totalCollateralUsd: 0,
                totalDebtUsd: 0,
                availableBorrowsUsd: 0,
                currentLiquidationThreshold: 0,
                ltv: 0,
                healthFactor: null,
              },
            };
          },
          async getLatest() {
            return null;
          },
          async readAaveAccount() {
            throw new Error("not used");
          },
          async readTokenBalances() {
            throw new Error("not used");
          },
        } satisfies import("../desk/position-service.ts").PositionService)
      : null;

    const plane = createDeskControlPlane({
      config,
      chainId: DESK_CHAIN_ID,
      deskWalletAddress: "0x1111111111111111111111111111111111111111",
      treasuryWalletAddress: "0x2222222222222222222222222222222222222222",
      usdcOperatingReserve: 5,
      treasurySafetyBufferEth: 0.01,
      heartbeats,
      positions,
      intents,
      tickets,
      capitalManager,
      capitalMoves,
      killSwitch,
      strategyRunner,
      signals,
      ...(agent ? { agent } : {}),
      ...(opts?.agentRuns !== undefined ? { agentRuns: opts.agentRuns } : {}),
      ...(opts?.execLogRepo !== undefined ? { execLogRepo: opts.execLogRepo } : {}),
      agentConfig: {
        llmConfigured: opts?.agentConfig?.llmConfigured ?? false,
        maxSignals: opts?.agentConfig?.maxSignals ?? 15,
        minConfidence: opts?.agentConfig?.minConfidence ?? 0.35,
        forceDefendOnCriticalHf: opts?.agentConfig?.forceDefendOnCriticalHf ?? true,
      },
      loadTreasuryBalances: async () => ({ usdcBalance: 100, ethBalance: 0.5 }),
      getDeskPaused: () => paused,
      setDeskPaused: (p) => {
        paused = p;
      },
    });

    return { plane, intents, evaluateCalls };
  }

  it("returns desk status with policy and kill state", async () => {
    const { plane } = buildPlane();
    const status = await plane.getStatus();
    expect(status.chainId).toBe(DESK_CHAIN_ID);
    expect(status.targetAumUsdc).toBe(50);
    expect(status.killSwitch.armed).toBe(false);
    expect(status.heartbeat.killEligible).toBe(true);
    expect(status.agentEnabled).toBe(false);
    expect(status.agentBlockedReason).toBe("agent_not_wired");
  });

  it("runs capital tick with treasury balances", async () => {
    const { plane } = buildPlane();
    const result = await plane.runCapitalTick({});
    expect(result.treasuryUsdc).toBe(100);
    expect(result.capital.decision.action).toBe("none");
  });

  it("touches heartbeat on desk tick and always returns agent proposal", async () => {
    const { plane } = buildPlane();
    const result = await plane.runDeskTick({ source: "scheduler", evaluateKill: false });
    expect(result.heartbeat.source).toBe("scheduler");
    expect(result.evaluations).toEqual([]);
    expect(result.agentProposal?.action).toBe("hold");
    expect(result.agentProposal?.declineReasons).toContain("agent_not_wired");
    expect(result.agentProposal?.declineReasons).toContain("llm_path_mandatory");
  });

  it("does not open risk strategies without agent authorization (no legacy path)", async () => {
    const apySignal: DeskSignalRow = {
      id: "sig-apy-1",
      signal_type: "apy_delta",
      chain_id: DESK_CHAIN_ID,
      severity: 60,
      policy_verdict: "trade",
      features: {
        apyDeltaBps: 120,
        consecutiveEdgePolls: 3,
        aaveSupplyApyBps: 120,
        idleUsdcApyBps: 0,
      },
      sources: { pollKind: "desk-rates-poll" },
      dedupe_key: "apy:1",
      created_at: "2026-07-28T00:00:00.000Z",
    };

    const { plane, evaluateCalls } = buildPlane({
      signals: [apySignal],
      agentConfig: { llmConfigured: false },
    });

    // positions=null → mark null → strategy loop skipped entirely (fail closed)
    const result = await plane.runDeskTick({
      source: "api",
      evaluateKill: false,
      agentProposal: {
        version: 1,
        action: "hold",
        strategy: null,
        notionalUsdc: 0,
        priority: 0,
        confidence: 1,
        thesis: "hold",
        riskNotes: [],
        legsHint: ["none"],
        declineReasons: [],
      },
    });

    expect(result.agentProposal?.action).toBe("hold");
    expect(evaluateCalls).toHaveLength(0);
  });

  it("only evaluates the agent-authorized strategy when LLM proposes", async () => {
    const apySignal: DeskSignalRow = {
      id: "sig-apy-1",
      signal_type: "apy_delta",
      chain_id: DESK_CHAIN_ID,
      severity: 60,
      policy_verdict: "trade",
      features: {
        apyDeltaBps: 120,
        consecutiveEdgePolls: 3,
        aaveSupplyApyBps: 120,
        idleUsdcApyBps: 0,
      },
      sources: { pollKind: "desk-rates-poll" },
      dedupe_key: "apy:1",
      created_at: "2026-07-28T00:00:00.000Z",
    };
    const basisSignal: DeskSignalRow = {
      id: "sig-basis-1",
      signal_type: "oracle_basis",
      chain_id: DESK_CHAIN_ID,
      severity: 55,
      policy_verdict: "trade",
      features: { basisBps: 80 },
      sources: { pollKind: "desk-basis-poll" },
      dedupe_key: "basis:1",
      created_at: "2026-07-28T00:00:00.000Z",
    };

    const { plane, evaluateCalls } = buildPlane({
      withLiveMark: true,
      signals: [apySignal, basisSignal],
      agentConfig: { llmConfigured: true },
      agentProposalFromRun: {
        version: 1,
        action: "propose",
        strategy: "yield_rotation",
        notionalUsdc: 10,
        priority: 0.8,
        confidence: 0.9,
        thesis: "rotate into aave link",
        riskNotes: [],
        legsHint: ["usdc_to_link"],
        declineReasons: [],
      },
      evaluateAndPropose: async (input) => ({
        plan: {
          action: "propose",
          strategy: input.strategy,
          notionalUsdc: 10,
          legs: [],
          reasonCodes: ["test_propose"],
          riskIncreasing: true,
          severity: 50,
          policyVerdict: "trade",
        },
      }),
    });

    const result = await plane.runDeskTick({ source: "api", evaluateKill: false });

    expect(result.agentProposal?.action).toBe("propose");
    expect(result.agentProposal?.strategy).toBe("yield_rotation");
    expect(evaluateCalls.map((c) => c.strategy)).toEqual(["yield_rotation"]);
    const unauthorized = result.evaluations.find((e) => e.strategy === "oracle_amm");
    expect(unauthorized?.planAction).toBe("agent_not_authorized");
  });

  it("applies successful execution result and publishes ticket", async () => {
    const { plane } = buildPlane({
      intents: [sampleIntent({ status: "executing" })],
    });
    const result = await plane.applyExecutionResult({
      intentId: "intent-1",
      success: true,
      keeperHubRunId: "kh-run-9",
      fills: [{ txHash: "0xfill", step: 0 }],
    });
    expect(result.intent.status).toBe("filled");
    expect(result.ticket?.ticketHash).toBe("0xabc");
  });

  it("rejects success without real fills", async () => {
    const { plane } = buildPlane();
    await expect(
      plane.applyExecutionResult({
        intentId: "intent-1",
        success: true,
        fills: [],
      }),
    ).rejects.toThrow(/txHash/);
  });

  it("arms kill switch without tripping by default", async () => {
    const { plane } = buildPlane();
    const result = await plane.armKill({ reason: "demo_kill" });
    expect(result.state.armed).toBe(true);
    expect(result.state.armedReason).toBe("demo_kill");
    expect(result.trip).toBeUndefined();
  });

  it("lists public tickets by id", async () => {
    const { plane } = buildPlane();
    const ticket = await plane.getTicket("ticket-1");
    expect(ticket?.ticket_hash).toBe("0xabc");
    expect(await plane.getTicket("missing")).toBeNull();
  });

  it("persists agent run and logs desk_agent succeeded once per runAgentOnly", async () => {
    const created: DeskAgentRunRow = {
      id: "agent-run-1",
      model: "test-model",
      latency_ms: 1,
      proposal: {
        version: 1,
        action: "hold",
        strategy: null,
        notionalUsdc: 0,
        priority: 0,
        confidence: 0.5,
        thesis: "flat book",
        riskNotes: [],
        legsHint: ["none"],
        declineReasons: [],
      },
      context_digest: {},
      intent_id: null,
      error_message: null,
      created_at: "2026-07-28T00:00:00.000Z",
    };

    const agentRuns: DeskAgentRunRepository = {
      create: vi.fn().mockResolvedValue({ ok: true, value: created }),
      findById: vi.fn(),
      update: vi.fn(),
      listRecent: vi.fn(),
      findLatest: vi.fn().mockResolvedValue({ ok: true, value: null }),
      linkIntent: vi.fn(),
    };

    const append = vi.fn().mockResolvedValue({ ok: true, value: {} });
    const execLogRepo = {
      append,
      listByEntity: vi.fn(),
      listRecent: vi.fn(),
      listPage: vi.fn(),
    } satisfies ExecutionLogRepository;

    const { plane } = buildPlane({
      agentConfig: { llmConfigured: true },
      agentProposalFromRun: {
        version: 1,
        action: "hold",
        strategy: null,
        notionalUsdc: 0,
        priority: 0,
        confidence: 0.5,
        thesis: "flat book",
        riskNotes: [],
        legsHint: ["none"],
        declineReasons: [],
      },
      agentRuns,
      execLogRepo,
    });

    const result = await plane.runAgentOnly({});
    expect(result.agentRunId).toBe("agent-run-1");
    expect(agentRuns.create).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: "desk_agent",
        entity_type: "desk_agent_run",
        entity_id: "agent-run-1",
        status: "succeeded",
      }),
    );
  });

  it("logs and surfaces agentRuns insert failures instead of silent null", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const agentRuns: DeskAgentRunRepository = {
      create: vi.fn().mockResolvedValue({
        ok: false,
        error: { message: "RLS denied", code: "42501", statusCode: 403 },
      }),
      findById: vi.fn(),
      update: vi.fn(),
      listRecent: vi.fn(),
      findLatest: vi.fn(),
      linkIntent: vi.fn(),
    };

    const append = vi.fn().mockResolvedValue({ ok: true, value: {} });
    const execLogRepo = {
      append,
      listByEntity: vi.fn(),
      listRecent: vi.fn(),
      listPage: vi.fn(),
    } satisfies ExecutionLogRepository;

    const { plane } = buildPlane({
      agentConfig: { llmConfigured: true },
      agentProposalFromRun: {
        version: 1,
        action: "hold",
        strategy: null,
        notionalUsdc: 0,
        priority: 0,
        confidence: 0.5,
        thesis: "flat book",
        riskNotes: [],
        legsHint: ["none"],
        declineReasons: [],
      },
      agentRuns,
      execLogRepo,
    });

    const result = await plane.runAgentOnly({});
    expect(result.agentRunId).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      "[desk-agent] desk_agent_runs insert failed:",
      "RLS denied",
      "42501",
      expect.any(Object),
    );
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: "desk_agent",
        status: "failed",
        details: expect.objectContaining({
          phase: "persist_agent_run",
          reason: "insert_failed",
          errorMessage: "RLS denied",
        }),
      }),
    );

    errorSpy.mockRestore();
  });

  it("writes started + succeeded desk_agent execution_logs on desk tick", async () => {
    const logs: ExecutionLogInsert[] = [];
    const execLogRepo = {
      append: vi.fn(async (data: ExecutionLogInsert) => {
        logs.push(data);
        return { ok: true as const, value: {} as never };
      }),
      listByEntity: vi.fn(),
      listRecent: vi.fn(),
      listPage: vi.fn(),
    } satisfies ExecutionLogRepository;

    const { plane } = buildPlane({ execLogRepo });
    const result = await plane.runDeskTick({ source: "scheduler", evaluateKill: false });

    expect(result.heartbeat.source).toBe("scheduler");
    expect(logs.some((l) => l.status === "started" && l.entity_type === "desk_tick")).toBe(
      true,
    );
    expect(
      logs.some(
        (l) =>
          l.status === "succeeded" &&
          l.entity_type === "desk_tick" &&
          l.action_type === "desk_agent",
      ),
    ).toBe(true);
  });
});
