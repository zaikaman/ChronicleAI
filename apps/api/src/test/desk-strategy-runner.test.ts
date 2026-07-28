import { describe, expect, it, vi } from "vitest";
import { createPolicyEngine } from "../desk/policy-engine.ts";
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
      markFilled: vi.fn(async () => ({ ...intent, status: "filled" as const })),
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
});
