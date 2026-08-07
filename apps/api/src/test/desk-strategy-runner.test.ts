import { describe, expect, it, vi } from "vitest";
import { createPolicyEngine } from "../desk/policy-engine.ts";
import { AAVE_MAX_UINT256 } from "../desk/workflow-inputs.ts";
import { createStrategyRunner } from "../desk/strategy-runner.ts";
import type { DeskPolicyConfig } from "../desk/types.ts";
import type { IntentService } from "../desk/intent-service.ts";
import type { ExecutionBridge } from "../desk/execution-bridge.ts";
import type { DeskIntentRow } from "@chronicleai/db";

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

const DESK = "0x1111111111111111111111111111111111111111";

function makeIntent(overrides: Partial<DeskIntentRow> = {}): DeskIntentRow {
  return {
    // UUID so execution_log entity_id is accepted (non-UUID → null + entity_ref).
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    signal_id: null,
    strategy: "risk_defend",
    status: "proposed",
    notional_usdc: 10,
    legs: [
      {
        protocol: "aave-v3",
        action: "repay",
        asset: "USDC",
        amount: "10",
      },
    ],
    reason_codes: ["hf_warn"],
    policy_snapshot: {},
    keeper_hub_run_id: null,
    error_message: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as DeskIntentRow;
}

describe("strategy-runner", () => {
  const policy = createPolicyEngine(config);

  it("plans risk defend from HF features", () => {
    const intents = {
      propose: vi.fn(),
    } as unknown as IntentService;
    const runner = createStrategyRunner({ config, policy, intents });
    const plan = runner.plan(
      "risk_defend",
      { hf: 1.1, totalDebtUsd: 40, totalCollateralUsd: 80 },
      {
        freeUsdc: 20,
        deskEquityUsdc: 50,
        totalDebtUsd: 40,
        totalCollateralUsd: 80,
      },
    );
    expect(plan.action).toBe("propose");
  });

  it("evaluateAndPropose creates intent when policy allows", async () => {
    const proposed = makeIntent();
    const intents: IntentService = {
      propose: vi.fn(async () => proposed),
      findById: vi.fn(),
      listRecent: vi.fn(), listPage: vi.fn(),
      listOpen: vi.fn(),
      findOpenByStrategy: vi.fn(),
      transition: vi.fn(),
      approve: vi.fn(),
      markExecuting: vi.fn(),
      markFilled: vi.fn(),
      reconcileFilled: vi.fn(),
      markFailed: vi.fn(),
      markDeferred: vi.fn(),
      cancel: vi.fn(),
      hasOpenForStrategy: vi.fn(),
      hasAnyOpen: vi.fn(),
      isTerminal: vi.fn(),
      isOpen: vi.fn(),
      canTransition: vi.fn(),
    };
    const runner = createStrategyRunner({ config, policy, intents });
    const result = await runner.evaluateAndPropose({
      strategy: "risk_defend",
      features: { hf: 1.3, totalDebtUsd: 40, totalCollateralUsd: 100 },
      inventory: {
        freeUsdc: 25,
        deskEquityUsdc: 50,
        totalDebtUsd: 40,
        totalCollateralUsd: 100,
      },
      gasRegime: "normal",
      killSwitchArmed: false,
      openByStrategy: {},
    });
    expect(result.plan.action).toBe("propose");
    expect(result.intent?.id).toBe("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    expect(intents.propose).toHaveBeenCalled();
  });

  it("executeIntent marks filled only with real tx hash", async () => {
    const intent = makeIntent({
      policy_snapshot: {
        gasRegime: "normal",
        simulatedHfAfter: 1.45,
        reasonCodes: ["hf_warn"],
      },
    });
    const intents: IntentService = {
      propose: vi.fn(),
      findById: vi.fn(async () => intent),
      listRecent: vi.fn(), listPage: vi.fn(),
      listOpen: vi.fn(),
      findOpenByStrategy: vi.fn(),
      transition: vi.fn(),
      approve: vi.fn(),
      markExecuting: vi.fn(async () => ({ ...intent, status: "executing" as const })),
      markFilled: vi.fn(async () => ({ ...intent, status: "filled" as const })),
      reconcileFilled: vi.fn(async () => ({ ...intent, status: "filled" as const })),
      markFailed: vi.fn(async (_id, msg) => ({
        ...intent,
        status: "failed" as const,
        error_message: msg,
      })),
      markDeferred: vi.fn(),
      cancel: vi.fn(),
      hasOpenForStrategy: vi.fn(),
      hasAnyOpen: vi.fn(),
      isTerminal: vi.fn(),
      isOpen: vi.fn(),
      canTransition: vi.fn(),
    };
    const bridge: ExecutionBridge = {
      execute: vi.fn(async () => ({
        keeperHubRunId: "run-9",
        txHash: "0xdead",
        explorerUrl: "https://sepolia.etherscan.io/tx/0xdead",
        status: "completed",
        gasUsed: "61234",
      })),
      actionForStrategy: vi.fn(() => "defend" as const),
      requireWorkflowId: vi.fn(() => "wf"),
      isConfigured: vi.fn(() => true),
    };
    const execLogRepo = {
      append: vi.fn().mockResolvedValue({ ok: true, value: {} }),
      listByEntity: vi.fn(),
      listRecent: vi.fn(),
      listPage: vi.fn(),
    };
    const runner = createStrategyRunner({
      config,
      policy,
      intents,
      executionBridge: bridge,
      execLogRepo: execLogRepo as never,
    });
    const intentId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const result = await runner.executeIntent({
      intentId,
      deskAddress: DESK,
      inventory: { freeUsdc: 20, deskEquityUsdc: 50 },
      publishTicket: false,
    });
    expect(result.intent.status).toBe("filled");
    expect(result.receipt?.txHash).toBe("0xdead");
    expect(intents.markFilled).toHaveBeenCalled();
    expect(result.executionAudit?.version).toBe(1);
    expect(result.executionAudit?.stages.preflight.status).toBe("passed");
    expect(result.executionAudit?.stages.preflight.policy?.simulatedHfAfter).toBe(
      1.45,
    );
    expect(result.executionAudit?.stages.submit.keeperHubRunId).toBe("run-9");
    expect(result.executionAudit?.stages.outcome.status).toBe("filled");
    expect(result.executionAudit?.stages.outcome.gasUsed).toBe("61234");
    expect(result.executionAudit?.stages.outcome.txHashes).toEqual(["0xdead"]);
    expect(execLogRepo.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: "desk_intent",
        entity_type: "desk_intent",
        entity_id: intentId,
        status: "started",
      }),
    );
    expect(execLogRepo.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: "desk_intent",
        status: "succeeded",
        details: expect.objectContaining({
          keeper_hub_run_id: "run-9",
          tx_hash: "0xdead",
          executedViaKeeperHub: true,
          execution_audit_version: 1,
          outcome_status: "filled",
        }),
      }),
    );
  });

  it("executeIntent publishes ticket with executionAudit.version === 1", async () => {
    const intent = makeIntent({
      policy_snapshot: { gasRegime: "normal", reasonCodes: ["hf_warn"] },
    });
    const intents: IntentService = {
      propose: vi.fn(),
      findById: vi.fn(async () => intent),
      listRecent: vi.fn(),
      listPage: vi.fn(),
      listOpen: vi.fn(),
      findOpenByStrategy: vi.fn(),
      transition: vi.fn(),
      approve: vi.fn(),
      markExecuting: vi.fn(async () => ({ ...intent, status: "executing" as const })),
      markFilled: vi.fn(async () => ({ ...intent, status: "filled" as const })),
      reconcileFilled: vi.fn(async () => ({ ...intent, status: "filled" as const })),
      markFailed: vi.fn(),
      markDeferred: vi.fn(),
      cancel: vi.fn(),
      hasOpenForStrategy: vi.fn(),
      hasAnyOpen: vi.fn(),
      isTerminal: vi.fn(),
      isOpen: vi.fn(),
      canTransition: vi.fn(),
    };
    const bridge: ExecutionBridge = {
      execute: vi.fn(async () => ({
        keeperHubRunId: "run-ticket",
        txHash: "0xbeef",
        explorerUrl: "https://sepolia.etherscan.io/tx/0xbeef",
        status: "completed",
        gasUsed: "50000",
      })),
      actionForStrategy: vi.fn(() => "defend" as const),
      requireWorkflowId: vi.fn(() => "wf"),
      isConfigured: vi.fn(() => true),
    };
    const publish = vi.fn(async (input: { executionAudit?: { version: number } }) => {
      expect(input.executionAudit?.version).toBe(1);
      return {
        ticket: { id: "ticket-1", payload: { executionAudit: input.executionAudit } },
        ticketHash: "0xhash",
        signalHash: "0xsig",
        intentHash: "0xint",
        contentUri: "https://example.com/desk/tickets/ticket-1",
        summary: "Desk risk_defend",
      };
    });
    const runner = createStrategyRunner({
      config,
      policy,
      intents,
      executionBridge: bridge,
      tickets: { publish } as never,
    });
    const result = await runner.executeIntent({
      intentId: intent.id,
      deskAddress: DESK,
      inventory: { freeUsdc: 20, deskEquityUsdc: 50 },
      publishTicket: true,
    });
    expect(result.ticket?.ticket.id).toBe("ticket-1");
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        executionAudit: expect.objectContaining({
          version: 1,
          stages: expect.objectContaining({
            preflight: expect.objectContaining({ status: "passed" }),
            submit: expect.objectContaining({ keeperHubRunId: "run-ticket" }),
            outcome: expect.objectContaining({
              status: "filled",
              txHashes: ["0xbeef"],
            }),
          }),
        }),
      }),
    );
  });

  it("executeIntent fails without fake fill when tx missing", async () => {
    const intent = makeIntent();
    const intents: IntentService = {
      propose: vi.fn(),
      findById: vi.fn(async () => intent),
      listRecent: vi.fn(), listPage: vi.fn(),
      listOpen: vi.fn(),
      findOpenByStrategy: vi.fn(),
      transition: vi.fn(),
      approve: vi.fn(),
      markExecuting: vi.fn(async () => ({ ...intent, status: "executing" as const })),
      markFilled: vi.fn(),
      reconcileFilled: vi.fn(),
      markFailed: vi.fn(async (_id, msg) => ({
        ...intent,
        status: "failed" as const,
        error_message: msg,
      })),
      markDeferred: vi.fn(),
      cancel: vi.fn(),
      hasOpenForStrategy: vi.fn(),
      hasAnyOpen: vi.fn(),
      isTerminal: vi.fn(),
      isOpen: vi.fn(),
      canTransition: vi.fn(),
    };
    const bridge: ExecutionBridge = {
      execute: vi.fn(async () => ({
        keeperHubRunId: "run-empty",
        txHash: "",
        explorerUrl: "",
        status: "completed",
      })),
      actionForStrategy: vi.fn(() => "defend" as const),
      requireWorkflowId: vi.fn(() => "wf"),
      isConfigured: vi.fn(() => true),
    };
    const runner = createStrategyRunner({
      config,
      policy,
      intents,
      executionBridge: bridge,
    });
    const result = await runner.executeIntent({
      intentId: "intent-1",
      deskAddress: DESK,
      inventory: { freeUsdc: 20, deskEquityUsdc: 50 },
      publishTicket: false,
    });
    expect(result.intent.status).toBe("failed");
    expect(result.errorMessage).toMatch(/without tx hash/);
    expect(intents.markFilled).not.toHaveBeenCalled();
  });

  it("Layer A soft: dry-run wouldRevert still executes workflow", async () => {
    const intent = makeIntent({
      policy_snapshot: { gasRegime: "normal", reasonCodes: ["hf_warn"] },
    });
    const intents: IntentService = {
      propose: vi.fn(),
      findById: vi.fn(async () => intent),
      listRecent: vi.fn(),
      listPage: vi.fn(),
      listOpen: vi.fn(),
      findOpenByStrategy: vi.fn(),
      transition: vi.fn(),
      approve: vi.fn(),
      markExecuting: vi.fn(async () => ({ ...intent, status: "executing" as const })),
      markFilled: vi.fn(async () => ({ ...intent, status: "filled" as const })),
      reconcileFilled: vi.fn(async () => ({ ...intent, status: "filled" as const })),
      markFailed: vi.fn(),
      markDeferred: vi.fn(),
      cancel: vi.fn(),
      hasOpenForStrategy: vi.fn(),
      hasAnyOpen: vi.fn(),
      isTerminal: vi.fn(),
      isOpen: vi.fn(),
      canTransition: vi.fn(),
    };
    const bridge: ExecutionBridge = {
      execute: vi.fn(async () => ({
        keeperHubRunId: "run-soft",
        txHash: "0xsoft",
        explorerUrl: "https://sepolia.etherscan.io/tx/0xsoft",
        status: "completed",
        gasUsed: "70000",
      })),
      actionForStrategy: vi.fn(() => "defend" as const),
      requireWorkflowId: vi.fn(() => "wf"),
      isConfigured: vi.fn(() => true),
    };
    const simResult = {
      khSimulate: {
        attempted: true,
        status: "failed" as const,
        wouldRevert: true,
        revertReason: "Error(insufficient allowance)",
        gasEstimate: "55000",
        endpoint: "contract-call" as const,
        legCount: 2,
        passedLegs: 1,
        failedLegs: 1,
      },
      shouldBlock: false,
    };
    const khSimulatePreflight = {
      isEnabled: () => true,
      isStrict: () => false,
      simulateWorkflow: vi.fn(async () => simResult),
      simulatePrimaryLeg: vi.fn(async () => simResult),
    };
    const runner = createStrategyRunner({
      config,
      policy,
      intents,
      executionBridge: bridge,
      khSimulatePreflight,
    });
    const result = await runner.executeIntent({
      intentId: intent.id,
      deskAddress: DESK,
      inventory: { freeUsdc: 20, deskEquityUsdc: 50 },
      publishTicket: false,
    });
    expect(bridge.execute).toHaveBeenCalled();
    expect(result.intent.status).toBe("filled");
    expect(result.executionAudit?.stages.preflight.khSimulate?.wouldRevert).toBe(true);
    expect(result.executionAudit?.stages.preflight.status).toBe("partial");
    expect(result.executionAudit?.summaryLine).toMatch(/KH sim failed/);
    expect(result.executionAudit?.stages.outcome.gasEstimateVsUsed?.estimate).toBe(
      "55000",
    );
  });

  it("Layer A strict: wouldRevert blocks execute and skips submit", async () => {
    const intent = makeIntent();
    const intents: IntentService = {
      propose: vi.fn(),
      findById: vi.fn(async () => intent),
      listRecent: vi.fn(),
      listPage: vi.fn(),
      listOpen: vi.fn(),
      findOpenByStrategy: vi.fn(),
      transition: vi.fn(),
      approve: vi.fn(),
      markExecuting: vi.fn(),
      markFilled: vi.fn(),
      reconcileFilled: vi.fn(),
      markFailed: vi.fn(async (_id, msg) => ({
        ...intent,
        status: "failed" as const,
        error_message: msg,
      })),
      markDeferred: vi.fn(),
      cancel: vi.fn(),
      hasOpenForStrategy: vi.fn(),
      hasAnyOpen: vi.fn(),
      isTerminal: vi.fn(),
      isOpen: vi.fn(),
      canTransition: vi.fn(),
    };
    const bridge: ExecutionBridge = {
      execute: vi.fn(),
      actionForStrategy: vi.fn(() => "defend" as const),
      requireWorkflowId: vi.fn(() => "wf"),
      isConfigured: vi.fn(() => true),
    };
    const simResult = {
      khSimulate: {
        attempted: true,
        status: "failed" as const,
        wouldRevert: true,
        revertReason: "Error(execution reverted)",
        endpoint: "contract-call" as const,
        legCount: 2,
        passedLegs: 1,
        failedLegs: 1,
      },
      shouldBlock: true,
      blockReason: "kh_simulate_would_revert",
    };
    const khSimulatePreflight = {
      isEnabled: () => true,
      isStrict: () => true,
      simulateWorkflow: vi.fn(async () => simResult),
      simulatePrimaryLeg: vi.fn(async () => simResult),
    };
    const runner = createStrategyRunner({
      config,
      policy,
      intents,
      executionBridge: bridge,
      khSimulatePreflight,
    });
    const result = await runner.executeIntent({
      intentId: intent.id,
      deskAddress: DESK,
      inventory: { freeUsdc: 20, deskEquityUsdc: 50 },
      publishTicket: false,
    });
    expect(bridge.execute).not.toHaveBeenCalled();
    expect(intents.markExecuting).not.toHaveBeenCalled();
    expect(result.intent.status).toBe("failed");
    expect(result.errorMessage).toMatch(/reverted|kh_simulate/);
    expect(result.executionAudit?.stages.preflight.status).toBe("failed");
    expect(result.executionAudit?.stages.preflight.notes).toBe(
      "kh_simulate_would_revert",
    );
    expect(result.executionAudit?.stages.submit.status).toBe("skipped");
    expect(result.executionAudit?.stages.outcome.status).toBe("skipped");
  });


  it("executeIntent caps rotate-in swap to live USDC balance at execution", async () => {
    // Mark says freeUsdc=20 and intent sized 15, but the wallet only holds 10.
    // The swap must be resized to 10 so Uniswap never reverts with 'STF'.
    const intent = makeIntent({
      strategy: "yield_rotation",
      notional_usdc: 15,
      legs: [
        {
          protocol: "uniswap",
          action: "swap-exact-input",
          tokenIn: "USDC",
          tokenOut: "LINK",
          amountIn: "15",
          note: "rotate_usdc_to_link",
        },
        { protocol: "aave-v3", action: "supply", amount: "min(policy,balance)" },
      ],
      reason_codes: ["yield_rotation", "apy_delta"],
      policy_snapshot: { gasRegime: "normal", reasonCodes: ["policy_ok"] },
    });
    const intents: IntentService = {
      propose: vi.fn(),
      findById: vi.fn(async () => intent),
      listRecent: vi.fn(),
      listPage: vi.fn(),
      listOpen: vi.fn(),
      findOpenByStrategy: vi.fn(),
      transition: vi.fn(),
      approve: vi.fn(),
      markExecuting: vi.fn(async () => ({ ...intent, status: "executing" as const })),
      markFilled: vi.fn(async () => ({ ...intent, status: "filled" as const })),
      reconcileFilled: vi.fn(async () => ({ ...intent, status: "filled" as const })),
      markFailed: vi.fn(),
      markDeferred: vi.fn(),
      cancel: vi.fn(),
      hasOpenForStrategy: vi.fn(),
      hasAnyOpen: vi.fn(),
      isTerminal: vi.fn(),
      isOpen: vi.fn(),
      canTransition: vi.fn(),
    };
    const bridge: ExecutionBridge = {
      execute: vi.fn(async (_action: string, input: Record<string, unknown>) => ({
        keeperHubRunId: "run-live",
        txHash: "0xlive",
        explorerUrl: "https://sepolia.etherscan.io/tx/0xlive",
        status: "completed",
        gasUsed: "80000",
        input,
      })),
      actionForStrategy: vi.fn(() => "rotate" as const),
      requireWorkflowId: vi.fn(() => "wf"),
      isConfigured: vi.fn(() => true),
    };
    const runner = createStrategyRunner({
      config,
      policy,
      intents,
      executionBridge: bridge,
    });
    const result = await runner.executeIntent({
      intentId: intent.id,
      deskAddress: DESK,
      inventory: { freeUsdc: 20, deskEquityUsdc: 742, linkUsdPrice: 10 },
      publishTicket: false,
      liveUsdcBalance: 10,
    });
    expect(result.intent.status).toBe("filled");
    // 10 USDC base units (6 decimals), not the 15 the mark would have allowed.
    expect(bridge.execute).toHaveBeenCalledWith(
      "rotate",
      expect.objectContaining({ amountIn: "10000000" }),
      expect.anything(),
    );
    // amountLink sized from the capped notional (10 USDC / 10 price = 1 LINK).
    const calledWith = (bridge.execute as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(calledWith.amountLink).toBe("1000000000000000000");
  });

  it("executeIntent keeps mark sizing when live balance read is absent", async () => {
    const intent = makeIntent({
      strategy: "yield_rotation",
      notional_usdc: 15,
      legs: [
        {
          protocol: "uniswap",
          action: "swap-exact-input",
          tokenIn: "USDC",
          tokenOut: "LINK",
          amountIn: "15",
          note: "rotate_usdc_to_link",
        },
        { protocol: "aave-v3", action: "supply", amount: "min(policy,balance)" },
      ],
      reason_codes: ["yield_rotation", "apy_delta"],
      policy_snapshot: { gasRegime: "normal", reasonCodes: ["policy_ok"] },
    });
    const intents: IntentService = {
      propose: vi.fn(),
      findById: vi.fn(async () => intent),
      listRecent: vi.fn(),
      listPage: vi.fn(),
      listOpen: vi.fn(),
      findOpenByStrategy: vi.fn(),
      transition: vi.fn(),
      approve: vi.fn(),
      markExecuting: vi.fn(async () => ({ ...intent, status: "executing" as const })),
      markFilled: vi.fn(async () => ({ ...intent, status: "filled" as const })),
      reconcileFilled: vi.fn(async () => ({ ...intent, status: "filled" as const })),
      markFailed: vi.fn(),
      markDeferred: vi.fn(),
      cancel: vi.fn(),
      hasOpenForStrategy: vi.fn(),
      hasAnyOpen: vi.fn(),
      isTerminal: vi.fn(),
      isOpen: vi.fn(),
      canTransition: vi.fn(),
    };
    const bridge: ExecutionBridge = {
      execute: vi.fn(async (_action: string, input: Record<string, unknown>) => ({
        keeperHubRunId: "run-nolive",
        txHash: "0xnolive",
        explorerUrl: "https://sepolia.etherscan.io/tx/0xnolive",
        status: "completed",
        gasUsed: "80000",
        input,
      })),
      actionForStrategy: vi.fn(() => "rotate" as const),
      requireWorkflowId: vi.fn(() => "wf"),
      isConfigured: vi.fn(() => true),
    };
    const runner = createStrategyRunner({
      config,
      policy,
      intents,
      executionBridge: bridge,
    });
    await runner.executeIntent({
      intentId: intent.id,
      deskAddress: DESK,
      inventory: { freeUsdc: 20, deskEquityUsdc: 742, linkUsdPrice: 10 },
      publishTicket: false,
    });
    // No live balance → sizing uses the mark freeUsdc=20 capped to maxTrade 15.
    expect(bridge.execute).toHaveBeenCalledWith(
      "rotate",
      expect.objectContaining({ amountIn: "15000000" }),
      expect.anything(),
    );
  });

  it("executeIntent ignores NaN/negative live balance (fall back to mark)", async () => {
    const intent = makeIntent({
      strategy: "yield_rotation",
      notional_usdc: 15,
      legs: [
        {
          protocol: "uniswap",
          action: "swap-exact-input",
          tokenIn: "USDC",
          tokenOut: "LINK",
          amountIn: "15",
          note: "rotate_usdc_to_link",
        },
        { protocol: "aave-v3", action: "supply", amount: "min(policy,balance)" },
      ],
      reason_codes: ["yield_rotation", "apy_delta"],
      policy_snapshot: { gasRegime: "normal", reasonCodes: ["policy_ok"] },
    });
    const intents: IntentService = {
      propose: vi.fn(),
      findById: vi.fn(async () => intent),
      listRecent: vi.fn(),
      listPage: vi.fn(),
      listOpen: vi.fn(),
      findOpenByStrategy: vi.fn(),
      transition: vi.fn(),
      approve: vi.fn(),
      markExecuting: vi.fn(async () => ({ ...intent, status: "executing" as const })),
      markFilled: vi.fn(async () => ({ ...intent, status: "filled" as const })),
      reconcileFilled: vi.fn(async () => ({ ...intent, status: "filled" as const })),
      markFailed: vi.fn(),
      markDeferred: vi.fn(),
      cancel: vi.fn(),
      hasOpenForStrategy: vi.fn(),
      hasAnyOpen: vi.fn(),
      isTerminal: vi.fn(),
      isOpen: vi.fn(),
      canTransition: vi.fn(),
    };
    const bridge: ExecutionBridge = {
      execute: vi.fn(async (_action: string, input: Record<string, unknown>) => ({
        keeperHubRunId: "run-nan",
        txHash: "0xnan",
        explorerUrl: "https://sepolia.etherscan.io/tx/0xnan",
        status: "completed",
        gasUsed: "80000",
        input,
      })),
      actionForStrategy: vi.fn(() => "rotate" as const),
      requireWorkflowId: vi.fn(() => "wf"),
      isConfigured: vi.fn(() => true),
    };
    const runner = createStrategyRunner({
      config,
      policy,
      intents,
      executionBridge: bridge,
    });
    await runner.executeIntent({
      intentId: intent.id,
      deskAddress: DESK,
      inventory: { freeUsdc: 20, deskEquityUsdc: 742, linkUsdPrice: 10 },
      publishTicket: false,
      liveUsdcBalance: Number.NaN,
    });
    expect(bridge.execute).toHaveBeenCalledWith(
      "rotate",
      expect.objectContaining({ amountIn: "15000000" }),
      expect.anything(),
    );
  });

  it("executeIntent does not cap out_of_aave_link exit sizing by live balance", async () => {
    // Exits run exactly when free USDC is low — a live-balance cap must NOT
    // shrink the effective notional, or the near-full max-uint withdraw
    // detection is disabled and float sizing can revert 1-wei over-size.
    const intent = makeIntent({
      strategy: "yield_rotation",
      notional_usdc: 15,
      legs: [
        {
          protocol: "aave-v3",
          action: "withdraw",
          asset: "LINK",
          amount: "1.0",
          note: "rotate_out_withdraw_link",
        },
        {
          protocol: "uniswap",
          action: "swap-exact-input",
          tokenIn: "LINK",
          tokenOut: "USDC",
          amountIn: "1.0",
          note: "rotate_link_to_usdc",
        },
      ],
      reason_codes: ["yield_rotation", "out_of_aave_link", "free_usdc_shortfall"],
      policy_snapshot: { gasRegime: "normal", reasonCodes: ["policy_ok"] },
    });
    const intents: IntentService = {
      propose: vi.fn(),
      findById: vi.fn(async () => intent),
      listRecent: vi.fn(),
      listPage: vi.fn(),
      listOpen: vi.fn(),
      findOpenByStrategy: vi.fn(),
      transition: vi.fn(),
      approve: vi.fn(),
      markExecuting: vi.fn(async () => ({ ...intent, status: "executing" as const })),
      markFilled: vi.fn(async () => ({ ...intent, status: "filled" as const })),
      reconcileFilled: vi.fn(async () => ({ ...intent, status: "filled" as const })),
      markFailed: vi.fn(),
      markDeferred: vi.fn(),
      cancel: vi.fn(),
      hasOpenForStrategy: vi.fn(),
      hasAnyOpen: vi.fn(),
      isTerminal: vi.fn(),
      isOpen: vi.fn(),
      canTransition: vi.fn(),
    };
    const bridge: ExecutionBridge = {
      execute: vi.fn(async (_action: string, input: Record<string, unknown>) => ({
        keeperHubRunId: "run-exit",
        txHash: "0xexit",
        explorerUrl: "https://sepolia.etherscan.io/tx/0xexit",
        status: "completed",
        gasUsed: "80000",
        input,
      })),
      actionForStrategy: vi.fn(() => "rotate" as const),
      requireWorkflowId: vi.fn(() => "wf"),
      isConfigured: vi.fn(() => true),
    };
    const runner = createStrategyRunner({
      config,
      policy,
      intents,
      executionBridge: bridge,
    });
    await runner.executeIntent({
      intentId: intent.id,
      deskAddress: DESK,
      inventory: {
        freeUsdc: 20,
        deskEquityUsdc: 742,
        linkUsdPrice: 15,
        aaveLinkSupplied: 1,
      },
      publishTicket: false,
      // Wallet is nearly empty — exactly when this exit would be triggered.
      liveUsdcBalance: 2,
    });
    // Direction stays out_of_aave_link and the near-full exit still uses
    // max-uint withdraw (estimatedLink = 15/15 = 1.0 >= 0.99 * 1 LINK).
    expect(bridge.execute).toHaveBeenCalledWith(
      "rotate",
      expect.objectContaining({ direction: "out_of_aave_link" }),
      expect.anything(),
    );
    const calledWith = (bridge.execute as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(calledWith.amountLink).toBe(AAVE_MAX_UINT256);
  });

  it("Layer A disabled: no khSimulate on preflight (C+B unchanged)", async () => {
    const intent = makeIntent({
      policy_snapshot: { gasRegime: "normal", simulatedHfAfter: 1.4 },
    });
    const intents: IntentService = {
      propose: vi.fn(),
      findById: vi.fn(async () => intent),
      listRecent: vi.fn(),
      listPage: vi.fn(),
      listOpen: vi.fn(),
      findOpenByStrategy: vi.fn(),
      transition: vi.fn(),
      approve: vi.fn(),
      markExecuting: vi.fn(async () => ({ ...intent, status: "executing" as const })),
      markFilled: vi.fn(async () => ({ ...intent, status: "filled" as const })),
      reconcileFilled: vi.fn(async () => ({ ...intent, status: "filled" as const })),
      markFailed: vi.fn(),
      markDeferred: vi.fn(),
      cancel: vi.fn(),
      hasOpenForStrategy: vi.fn(),
      hasAnyOpen: vi.fn(),
      isTerminal: vi.fn(),
      isOpen: vi.fn(),
      canTransition: vi.fn(),
    };
    const bridge: ExecutionBridge = {
      execute: vi.fn(async () => ({
        keeperHubRunId: "run-off",
        txHash: "0xoff",
        explorerUrl: "https://sepolia.etherscan.io/tx/0xoff",
        status: "completed",
        gasUsed: "40000",
      })),
      actionForStrategy: vi.fn(() => "defend" as const),
      requireWorkflowId: vi.fn(() => "wf"),
      isConfigured: vi.fn(() => true),
    };
    const khSimulatePreflight = {
      isEnabled: () => false,
      isStrict: () => false,
      simulateWorkflow: vi.fn(),
      simulatePrimaryLeg: vi.fn(),
    };
    const runner = createStrategyRunner({
      config,
      policy,
      intents,
      executionBridge: bridge,
      khSimulatePreflight,
    });
    const result = await runner.executeIntent({
      intentId: intent.id,
      deskAddress: DESK,
      inventory: { freeUsdc: 20, deskEquityUsdc: 50 },
      publishTicket: false,
    });
    expect(khSimulatePreflight.simulateWorkflow).not.toHaveBeenCalled();
    expect(khSimulatePreflight.simulatePrimaryLeg).not.toHaveBeenCalled();
    expect(result.executionAudit?.stages.preflight.khSimulate).toBeUndefined();
    expect(result.executionAudit?.stages.preflight.status).toBe("passed");
    expect(result.intent.status).toBe("filled");
  });
});
