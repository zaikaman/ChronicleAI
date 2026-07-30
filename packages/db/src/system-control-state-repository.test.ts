import { describe, expect, it } from "vitest";
import { createInMemorySupabaseClient } from "./in-memory-supabase.ts";
import { createSystemControlStateRepository } from "./system-control-state-repository.ts";

describe("SystemControlStateRepository DB persistence", () => {
  it("loads default groq_key_index from DB singleton", async () => {
    const client = createInMemorySupabaseClient();
    const repo = createSystemControlStateRepository(client as any);

    const getRes = await repo.get();
    expect(getRes.ok).toBe(true);
    if (getRes.ok) {
      expect(getRes.value.id).toBe("default");
      expect(getRes.value.groq_key_index).toBe(0);
    }
  });

  it("persists groq_key_index updates and retrieves latest value", async () => {
    const client = createInMemorySupabaseClient();
    const repo = createSystemControlStateRepository(client as any);

    const upsertRes = await repo.upsert({ groq_key_index: 3 });
    expect(upsertRes.ok).toBe(true);
    if (upsertRes.ok) {
      expect(upsertRes.value.groq_key_index).toBe(3);
    }

    const checkRes = await repo.get();
    expect(checkRes.ok).toBe(true);
    if (checkRes.ok) {
      expect(checkRes.value.groq_key_index).toBe(3);
    }
  });
});
