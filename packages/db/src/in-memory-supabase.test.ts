import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInMemorySupabaseClient } from "./in-memory-supabase.ts";
import { createServerSupabaseClient } from "./supabase-server.ts";

describe("createInMemorySupabaseClient", () => {
  it("stores inserts only in process memory", async () => {
    const client = createInMemorySupabaseClient();

    const { data, error } = await client
      .from("monitored_events")
      .insert({ source: "test", source_event_id: "evt-1", status: "received" })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data).toMatchObject({ source: "test", source_event_id: "evt-1" });
    expect(typeof (data as { id: string }).id).toBe("string");

    const listed = await client.from("monitored_events").select("*");
    expect(listed.error).toBeNull();
    expect(listed.data).toHaveLength(1);
  });

  it("supports not(... is null) filters used by repositories", async () => {
    const client = createInMemorySupabaseClient();
    await client.from("payment_records").insert({ id: "a", expires_at: null });
    await client.from("payment_records").insert({ id: "b", expires_at: "2020-01-01T00:00:00.000Z" });

    const { data, error } = await client
      .from("payment_records")
      .select("*")
      .not("expires_at", "is", null);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect((data as Array<{ id: string }>)[0]?.id).toBe("b");
  });

  it("never opens network connections (rpc fails closed in-memory)", async () => {
    const client = createInMemorySupabaseClient();
    const result = await client.rpc("exec_sql", { query: "select 1" });
    expect(result.error?.message).toMatch(/not available/i);
  });
});

describe("createServerSupabaseClient isolation", () => {
  const prevIsolation = process.env.CHRONICLE_TEST_DB_ISOLATION;

  beforeEach(() => {
    process.env.CHRONICLE_TEST_DB_ISOLATION = "1";
  });

  afterEach(() => {
    if (prevIsolation === undefined) {
      delete process.env.CHRONICLE_TEST_DB_ISOLATION;
    } else {
      process.env.CHRONICLE_TEST_DB_ISOLATION = prevIsolation;
    }
  });

  it("returns an in-memory client when CHRONICLE_TEST_DB_ISOLATION=1", async () => {
    const client = createServerSupabaseClient({
      supabaseUrl: "https://real-project.supabase.co",
      supabaseServiceRoleKey: "would-be-dangerous",
    });

    // In-memory clients expose __reset; real supabase-js clients do not.
    expect(typeof (client as { __reset?: unknown }).__reset).toBe("function");

    const { error } = await client
      .from("public_alerts")
      .insert({ title: "isolated", summary: "no remote write" })
      .select()
      .single();
    expect(error).toBeNull();
  });
});
