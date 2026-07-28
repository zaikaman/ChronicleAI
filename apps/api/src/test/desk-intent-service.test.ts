import { describe, expect, it, vi } from "vitest";
import { createIntentService } from "../desk/intent-service.ts";
import type { DeskIntentRepository, DeskIntentRow } from "@chronicleai/db";
import type { DeskPolicySnapshot } from "../desk/types.ts";

function row(partial: Partial<DeskIntentRow> & { id: string; status: DeskIntentRow["status"] }): DeskIntentRow {
  return {
    signal_id: null,
    strategy: "oracle_amm",
    notional_usdc: 10,
    legs: [],
    reason_codes: [],
    policy_snapshot: {},
    keeper_hub_run_id: null,
    error_message: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...partial,
  };
}

describe("intent-service state machine", () => {
  it("allows proposed → approved → executing → filled", async () => {
    const store = new Map<string, DeskIntentRow>();
    store.set("i1", row({ id: "i1", status: "proposed" }));

    const intents: DeskIntentRepository = {
      create: vi.fn(),
      findById: async (id) => ({ ok: true, value: store.get(id) ?? null }),
      update: async (id, update) => {
        const current = store.get(id)!;
        const next = { ...current, ...update, updated_at: new Date().toISOString() } as DeskIntentRow;
        store.set(id, next);
        return { ok: true, value: next };
      },
      listRecent: async () => ({ ok: true, value: [] }),
      listPage: async () => ({
        ok: true,
        value: {
          items: [],
          page: 1,
          limit: 20,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      }),
      listByStatus: async () => ({ ok: true, value: [] }),
      findOpenByStrategy: async () => ({ ok: true, value: null }),
      listOpen: async () => ({ ok: true, value: [] }),
    };

    const service = createIntentService(intents);
    await service.approve("i1");
    expect(store.get("i1")!.status).toBe("approved");
    await service.markExecuting("i1", "run-1");
    expect(store.get("i1")!.status).toBe("executing");
    expect(store.get("i1")!.keeper_hub_run_id).toBe("run-1");
    await service.markFilled("i1");
    expect(store.get("i1")!.status).toBe("filled");
  });

  it("rejects illegal filled → executing", async () => {
    const store = new Map<string, DeskIntentRow>();
    store.set("i1", row({ id: "i1", status: "filled" }));

    const intents: DeskIntentRepository = {
      create: vi.fn(),
      findById: async (id) => ({ ok: true, value: store.get(id) ?? null }),
      update: vi.fn(),
      listRecent: async () => ({ ok: true, value: [] }),
      listPage: async () => ({
        ok: true,
        value: {
          items: [],
          page: 1,
          limit: 20,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      }),
      listByStatus: async () => ({ ok: true, value: [] }),
      findOpenByStrategy: async () => ({ ok: true, value: null }),
      listOpen: async () => ({ ok: true, value: [] }),
    };

    const service = createIntentService(intents);
    await expect(service.markExecuting("i1")).rejects.toThrow(/Illegal desk intent transition/);
  });

  it("refuses propose when open intent exists for strategy", async () => {
    const intents: DeskIntentRepository = {
      create: vi.fn(),
      findById: async () => ({ ok: true, value: null }),
      update: vi.fn(),
      listRecent: async () => ({ ok: true, value: [] }),
      listPage: async () => ({
        ok: true,
        value: {
          items: [],
          page: 1,
          limit: 20,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      }),
      listByStatus: async () => ({ ok: true, value: [] }),
      findOpenByStrategy: async () => ({
        ok: true,
        value: row({ id: "open-1", status: "executing", strategy: "oracle_amm" }),
      }),
      listOpen: async () => ({ ok: true, value: [] }),
    };

    const service = createIntentService(intents);
    const snapshot = {
      maxTradeUsdc: 15,
      minAumUsdc: 20,
      targetAumUsdc: 50,
      maxAumUsdc: 80,
      hfWarn: 1.5,
      hfCritical: 1.2,
      basisBps: 50,
      apyDeltaBps: 50,
      deskPaused: false,
      killSwitchArmed: false,
      gasRegime: "normal",
      deskEquityUsdc: 50,
      freeUsdc: 40,
      notionalUsdc: 10,
      reasonCodes: [],
      evaluatedAt: new Date().toISOString(),
    } satisfies DeskPolicySnapshot;

    await expect(
      service.propose({
        strategy: "oracle_amm",
        notionalUsdc: 10,
        legs: [],
        reasonCodes: [],
        policySnapshot: snapshot,
      }),
    ).rejects.toThrow(/Open desk intent already exists/);
  });
});
