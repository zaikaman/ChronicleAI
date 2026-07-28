// Unit tests: treasury-gated registry write evaluation (FR-026)

import type { TreasurySnapshotRepository, TreasurySnapshotRow } from "@chronicleai/db";
import { describe, expect, it, vi } from "vitest";
import { createTreasuryRegistryGate } from "../services/treasury-registry-gate.ts";
import { createTreasuryStatusService } from "../services/treasury-status-service.ts";

function snapshot(overrides: Partial<TreasurySnapshotRow> = {}): TreasurySnapshotRow {
  return {
    id: "snap-1",
    available_balance: 50_000,
    currency: "USD",
    safety_buffer: 10_000,
    revenue_total: null,
    estimated_generation_cost: null,
    estimated_transaction_cost: null,
    paid_request_count: null,
    status: "healthy",
    last_routed_at: null,
    last_payout_period_hash: null,
    total_routed_amount: null,
    captured_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function mockRepo(
  latest: TreasurySnapshotRow | null | { ok: false; error: { message: string } },
): TreasurySnapshotRepository {
  return {
    create: vi.fn(),
    findLatest: vi.fn().mockResolvedValue(
      latest && "ok" in latest && latest.ok === false
        ? latest
        : { ok: true, value: latest as TreasurySnapshotRow | null },
    ),
    findById: vi.fn(),
    list: vi.fn(),
    listStatusHistory: vi.fn(),
    update: vi.fn(),
    getAggregates: vi.fn(),
  };
}

const treasuryService = createTreasuryStatusService();

describe("TreasuryRegistryGate", () => {
  it("allows registry write when balance is at or above safety buffer", async () => {
    const gate = createTreasuryRegistryGate(
      mockRepo(snapshot({ available_balance: 15_000, safety_buffer: 10_000 })),
      treasuryService,
    );

    const decision = await gate.evaluate();

    expect(decision.allowRegistryWrite).toBe(true);
    expect(decision.availableBalance).toBe(15_000);
    expect(decision.safetyBuffer).toBe(10_000);
    expect(decision.status).toBe("healthy");
  });

  it("allows registry write when balance equals safety buffer", async () => {
    const gate = createTreasuryRegistryGate(
      mockRepo(snapshot({ available_balance: 10_000, safety_buffer: 10_000 })),
      treasuryService,
    );

    const decision = await gate.evaluate();

    expect(decision.allowRegistryWrite).toBe(true);
  });

  it("suspends registry write when balance is below safety buffer", async () => {
    const gate = createTreasuryRegistryGate(
      mockRepo(
        snapshot({
          available_balance: 7_000,
          safety_buffer: 10_000,
          status: "warning",
        }),
      ),
      treasuryService,
    );

    const decision = await gate.evaluate();

    expect(decision.allowRegistryWrite).toBe(false);
    expect(decision.reason).toContain("below safety buffer");
    expect(decision.availableBalance).toBe(7_000);
    expect(decision.safetyBuffer).toBe(10_000);
    expect(decision.status).toBe("warning");
    expect(decision.deficitPercentage).toBeGreaterThan(0);
    expect(decision.snapshotId).toBe("snap-1");
  });

  it("suspends registry write when balance is critical", async () => {
    const gate = createTreasuryRegistryGate(
      mockRepo(
        snapshot({
          available_balance: 1_000,
          safety_buffer: 10_000,
          status: "critical",
        }),
      ),
      treasuryService,
    );

    const decision = await gate.evaluate();

    expect(decision.allowRegistryWrite).toBe(false);
    expect(decision.status).toBe("critical");
  });

  it("fail-opens when no treasury snapshot exists yet", async () => {
    const gate = createTreasuryRegistryGate(mockRepo(null), treasuryService);

    const decision = await gate.evaluate();

    expect(decision.allowRegistryWrite).toBe(true);
    expect(decision.reason).toMatch(/no treasury snapshot/i);
  });

  it("fail-opens when treasury snapshot lookup fails", async () => {
    const gate = createTreasuryRegistryGate(
      mockRepo({ ok: false, error: { message: "db down" } }),
      treasuryService,
    );

    const decision = await gate.evaluate();

    expect(decision.allowRegistryWrite).toBe(true);
    expect(decision.reason).toMatch(/lookup failed/i);
  });
});
