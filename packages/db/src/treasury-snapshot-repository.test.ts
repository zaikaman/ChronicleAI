import { describe, expect, it } from "vitest";
import { createInMemorySupabaseClient } from "./in-memory-supabase.ts";
import { createTreasurySnapshotRepository } from "./treasury-snapshot-repository.ts";

describe("treasury snapshot aggregates", () => {
  it("reads settled payment totals from the database aggregate", async () => {
    const client = createInMemorySupabaseClient();
    await client.from("treasury_snapshots").insert({
      id: "snapshot-1",
      available_balance: 100,
      safety_buffer: 10,
      status: "healthy",
      captured_at: "2026-08-01T00:00:00.000Z",
    });
    await client.from("payment_records").insert([
      { id: "settled-1", status: "settled", amount_settled: 12.5 },
      { id: "settled-2", status: "settled", amount_settled: 7.5 },
      { id: "open-1", status: "challenge_issued", amount_settled: null },
    ]);

    const repository = createTreasurySnapshotRepository(client as never);
    const result = await repository.getAggregates();

    expect(result).toEqual({
      ok: true,
      value: {
        totalRevenue: 20,
        totalPaidRequests: 2,
        latestBalance: 100,
        latestStatus: "healthy",
      },
    });
  });
});
