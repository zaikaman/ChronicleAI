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
});
