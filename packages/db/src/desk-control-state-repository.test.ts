import { describe, expect, it } from "vitest";
import { createInMemorySupabaseClient } from "./in-memory-supabase.ts";
import {
  createDeskControlStateRepository,
} from "./desk-control-state-repository.ts";
import { DESK_CONTROL_STATE_ID } from "./types.ts";

describe("desk-control-state-repository", () => {
  it("returns default singleton when empty, then upserts arm state", async () => {
    const client = createInMemorySupabaseClient();
    const repo = createDeskControlStateRepository(
      client as unknown as Parameters<typeof createDeskControlStateRepository>[0],
    );

    const initial = await repo.get();
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    expect(initial.value.id).toBe(DESK_CONTROL_STATE_ID);
    expect(initial.value.kill_armed).toBe(false);
    expect(initial.value.desk_paused).toBe(false);

    const armed = await repo.upsert({
      kill_armed: true,
      kill_armed_at: "2026-07-28T12:00:00.000Z",
      kill_armed_reason: "manual",
      desk_paused: true,
    });
    expect(armed.ok).toBe(true);
    if (!armed.ok) return;
    expect(armed.value.kill_armed).toBe(true);
    expect(armed.value.kill_armed_reason).toBe("manual");
    expect(armed.value.desk_paused).toBe(true);

    const reloaded = await repo.get();
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.value.kill_armed).toBe(true);
    expect(reloaded.value.kill_armed_reason).toBe("manual");
  });

  it("merges partial upsert without wiping trip history", async () => {
    const client = createInMemorySupabaseClient();
    const repo = createDeskControlStateRepository(
      client as unknown as Parameters<typeof createDeskControlStateRepository>[0],
    );

    await repo.upsert({
      kill_armed: true,
      kill_armed_reason: "a",
      last_trip_at: "2026-07-28T10:00:00.000Z",
      last_trip_reason: "trip_a",
      last_tx_hash: "0xdead",
      desk_paused: true,
    });

    const next = await repo.upsert({
      kill_armed: false,
      kill_armed_at: null,
      kill_armed_reason: null,
      desk_paused: false,
    });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.value.kill_armed).toBe(false);
    expect(next.value.last_trip_reason).toBe("trip_a");
    expect(next.value.last_tx_hash).toBe("0xdead");
  });
});
