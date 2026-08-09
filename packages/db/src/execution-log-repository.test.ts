import { describe, expect, it } from "vitest";
import { createExecutionLogRepository } from "./execution-log-repository.ts";
import { createInMemorySupabaseClient } from "./in-memory-supabase.ts";

describe("execution log diagnostics", () => {
  it("fetches failed diagnostics for multiple entities in one repository operation", async () => {
    const client = createInMemorySupabaseClient();
    const firstPaymentId = "11111111-1111-4111-8111-111111111111";
    const secondPaymentId = "22222222-2222-4222-8222-222222222222";

    await client.from("execution_logs").insert([
      {
        action_type: "payment",
        entity_type: "payment_record",
        entity_id: firstPaymentId,
        status: "failed",
        message: "first failure",
        details: {},
        started_at: "2026-08-01T00:00:00.000Z",
        created_at: "2026-08-01T00:00:02.000Z",
      },
      {
        action_type: "payment",
        entity_type: "payment_record",
        entity_id: secondPaymentId,
        status: "failed",
        message: "second failure",
        details: {},
        started_at: "2026-08-01T00:00:01.000Z",
        created_at: "2026-08-01T00:00:01.000Z",
      },
      {
        action_type: "payment",
        entity_type: "payment_record",
        entity_id: firstPaymentId,
        status: "succeeded",
        message: "not a diagnostic",
        details: {},
        started_at: "2026-08-01T00:00:03.000Z",
        created_at: "2026-08-01T00:00:03.000Z",
      },
    ]);

    const repository = createExecutionLogRepository(client as never);
    const listFailedByEntityIds = repository.listFailedByEntityIds;
    if (!listFailedByEntityIds) throw new Error("batch diagnostic method is not configured");
    const result = await listFailedByEntityIds("payment_record", [
      firstPaymentId,
      secondPaymentId,
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toEqual([
      {
        entity_id: firstPaymentId,
        status: "failed",
        message: "first failure",
        details: {},
      },
      {
        entity_id: secondPaymentId,
        status: "failed",
        message: "second failure",
        details: {},
      },
    ]);
  });

  it("deduplicates execution logs by unique transaction hash and excludes logs without tx hash", async () => {
    const client = createInMemorySupabaseClient();
    const sharedTxHash = "0x91a63dc071e8bc8a24c75ba717368c721a664568d6a1ae1cb5f415d8c5fd55db";
    const uniqueTxHash = "0x8039d8f7a2aa0f5f5c3b444d2c6c83d4cac45077562858753fc53be5872d6c4";

    await client.from("execution_logs").insert([
      {
        action_type: "desk_workflow",
        status: "succeeded",
        message: "first log for shared tx",
        details: { txHash: sharedTxHash },
        started_at: "2026-08-01T00:00:00.000Z",
        created_at: "2026-08-01T00:00:00.000Z",
      },
      {
        action_type: "desk_intent",
        status: "succeeded",
        message: "duplicate log for shared tx",
        details: { txHash: sharedTxHash },
        started_at: "2026-08-01T00:00:01.000Z",
        created_at: "2026-08-01T00:00:01.000Z",
      },
      {
        action_type: "notification",
        status: "succeeded",
        message: "log without tx hash",
        details: {},
        started_at: "2026-08-01T00:00:02.000Z",
        created_at: "2026-08-01T00:00:02.000Z",
      },
      {
        action_type: "desk_workflow",
        status: "succeeded",
        message: "log for second unique tx",
        details: { txHash: uniqueTxHash },
        started_at: "2026-08-01T00:00:03.000Z",
        created_at: "2026-08-01T00:00:03.000Z",
      },
    ]);

    const repository = createExecutionLogRepository(client as never);
    if (!repository.listAllChronological) throw new Error("listAllChronological method missing");
    const result = await repository.listAllChronological({ page: 1, limit: 100 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.total).toBe(2);
    expect(result.value.items.length).toBe(2);
    expect(result.value.items[0].message).toBe("first log for shared tx");
    expect(result.value.items[1].message).toBe("log for second unique tx");
  });
});
