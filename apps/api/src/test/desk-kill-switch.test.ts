import { describe, expect, it, vi } from "vitest";
import { createKillSwitchService } from "../desk/kill-switch-service.ts";
import type { ExecutionBridge } from "../desk/execution-bridge.ts";
import type { HeartbeatService } from "../desk/heartbeat-service.ts";
import type { DeskControlStateRepository, DeskControlStateRow } from "@chronicleai/db";
import { DESK_CONTROL_STATE_ID } from "@chronicleai/db";

const DESK = "0x1111111111111111111111111111111111111111";
const TREASURY = "0x2222222222222222222222222222222222222222";

function mockBridge(
  result: { txHash: string; keeperHubRunId: string } = {
    txHash: "0xabc",
    keeperHubRunId: "run-1",
  },
): ExecutionBridge {
  return {
    execute: vi.fn(async () => ({
      keeperHubRunId: result.keeperHubRunId,
      txHash: result.txHash,
      explorerUrl: `https://sepolia.etherscan.io/tx/${result.txHash}`,
      status: "completed",
    })),
    actionForStrategy: vi.fn(),
    requireWorkflowId: vi.fn(() => "wf"),
    isConfigured: vi.fn(() => true),
  };
}

function emptyControlRow(
  overrides: Partial<DeskControlStateRow> = {},
): DeskControlStateRow {
  return {
    id: DESK_CONTROL_STATE_ID,
    kill_armed: false,
    kill_armed_at: null,
    kill_armed_reason: null,
    last_trip_at: null,
    last_trip_reason: null,
    last_keeper_hub_run_id: null,
    last_tx_hash: null,
    desk_paused: false,
    last_maintenance_at: null,
    last_event_microtrade_at: null,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function memoryControlState(
  initial: DeskControlStateRow = emptyControlRow(),
): DeskControlStateRepository {
  let row = { ...initial };
  return {
    async get() {
      return { ok: true, value: { ...row } };
    },
    async upsert(patch) {
      row = {
        ...row,
        kill_armed: patch.kill_armed ?? row.kill_armed,
        kill_armed_at:
          patch.kill_armed_at !== undefined ? patch.kill_armed_at : row.kill_armed_at,
        kill_armed_reason:
          patch.kill_armed_reason !== undefined
            ? patch.kill_armed_reason
            : row.kill_armed_reason,
        last_trip_at:
          patch.last_trip_at !== undefined ? patch.last_trip_at : row.last_trip_at,
        last_trip_reason:
          patch.last_trip_reason !== undefined
            ? patch.last_trip_reason
            : row.last_trip_reason,
        last_keeper_hub_run_id:
          patch.last_keeper_hub_run_id !== undefined
            ? patch.last_keeper_hub_run_id
            : row.last_keeper_hub_run_id,
        last_tx_hash:
          patch.last_tx_hash !== undefined ? patch.last_tx_hash : row.last_tx_hash,
        desk_paused: patch.desk_paused ?? row.desk_paused,
        last_maintenance_at:
          patch.last_maintenance_at !== undefined
            ? patch.last_maintenance_at
            : row.last_maintenance_at,
        updated_at: new Date().toISOString(),
      };
      return { ok: true, value: { ...row } };
    },
  };
}

describe("kill-switch-service", () => {
  it("arms and disarms with pause side effect", async () => {
    let paused = false;
    const ks = createKillSwitchService({
      setDeskPaused: (p) => {
        paused = p;
      },
      getDeskPaused: () => paused,
    });
    const armed = await ks.arm("manual");
    expect(armed.armed).toBe(true);
    expect(paused).toBe(true);
    expect(ks.isArmed()).toBe(true);
    await ks.disarm();
    expect(ks.isArmed()).toBe(false);
    expect(paused).toBe(false);
  });

  it("persists arm state and restores on hydrate", async () => {
    const store = memoryControlState();
    let paused = false;

    const first = createKillSwitchService({
      controlState: store,
      setDeskPaused: (p) => {
        paused = p;
      },
      getDeskPaused: () => paused,
    });
    await first.arm("persist_me");
    expect(await ksArmed(store)).toBe(true);

    // Simulate process restart: new service instance over the same store.
    let paused2 = false;
    const second = createKillSwitchService({
      controlState: store,
      setDeskPaused: (p) => {
        paused2 = p;
      },
      getDeskPaused: () => paused2,
    });
    const restored = await second.hydrate();
    expect(restored.armed).toBe(true);
    expect(restored.armedReason).toBe("persist_me");
    expect(second.isArmed()).toBe(true);
    expect(paused2).toBe(true);
  });

  it("trips kill workflow and returns real tx hash", async () => {
    const bridge = mockBridge();
    const ks = createKillSwitchService({ executionBridge: bridge });
    const result = await ks.trip({
      reason: "manual_arm",
      freeUsdcOnDesk: 20,
      deskAddress: DESK,
      treasuryAddress: TREASURY,
      withdrawLink: true,
    });
    expect(result.tripped).toBe(true);
    expect(result.receipt?.txHash).toBe("0xabc");
    expect(ks.getState().lastTxHash).toBe("0xabc");
    expect(bridge.execute).toHaveBeenCalledWith(
      "kill_switch",
      expect.objectContaining({
        withdrawLink: "true",
        amount: "20",
      }),
      expect.any(Object),
    );
  });

  it("refuses fake fills without tx hash", async () => {
    const bridge = mockBridge({ txHash: "", keeperHubRunId: "run-empty" });
    const ks = createKillSwitchService({ executionBridge: bridge });
    const result = await ks.trip({
      reason: "test",
      freeUsdcOnDesk: 10,
      deskAddress: DESK,
      treasuryAddress: TREASURY,
    });
    expect(result.tripped).toBe(false);
    expect(result.errorMessage).toMatch(/without tx hash/);
  });

  it("evaluate trips on stale heartbeat", async () => {
    const bridge = mockBridge();
    const heartbeat: HeartbeatService = {
      touch: vi.fn(),
      getLatest: vi.fn(),
      getStatus: vi.fn(async () => ({
        lastSeenAt: null,
        ageMs: null,
        stale: true,
        killEligible: true,
        source: null,
      })),
      isStale: vi.fn(async () => true),
      prune: vi.fn(async () => 0),
    };
    const ks = createKillSwitchService({ executionBridge: bridge, heartbeat });
    const result = await ks.evaluate({
      freeUsdcOnDesk: 15,
      deskAddress: DESK,
      treasuryAddress: TREASURY,
    });
    expect(result.tripped).toBe(true);
    expect(ks.isArmed()).toBe(true);
  });

  it("evaluate no-ops when healthy and not armed", async () => {
    const bridge = mockBridge();
    const heartbeat: HeartbeatService = {
      touch: vi.fn(),
      getLatest: vi.fn(),
      getStatus: vi.fn(async () => ({
        lastSeenAt: new Date().toISOString(),
        ageMs: 1000,
        stale: false,
        killEligible: false,
        source: "api" as const,
      })),
      isStale: vi.fn(async () => false),
      prune: vi.fn(async () => 0),
    };
    const ks = createKillSwitchService({ executionBridge: bridge, heartbeat });
    const result = await ks.evaluate({
      freeUsdcOnDesk: 50,
      deskAddress: DESK,
      treasuryAddress: TREASURY,
    });
    expect(result.tripped).toBe(false);
    expect(bridge.execute).not.toHaveBeenCalled();
  });
});

async function ksArmed(store: DeskControlStateRepository): Promise<boolean> {
  const r = await store.get();
  if (!r.ok) return false;
  return r.value.kill_armed;
}
