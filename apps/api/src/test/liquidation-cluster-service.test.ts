// Unit tests for liquidation cluster synthesizer

import { describe, expect, it, vi } from "vitest";
import type { MonitoredEventRepository, MonitoredEventRow } from "@chronicleai/db";
import {
  buildLiquidationClusterSourceEventId,
  createLiquidationClusterService,
} from "../services/liquidation-cluster-service.ts";

function liqRow(overrides: Partial<MonitoredEventRow> & { id: string; captured_at: string }): MonitoredEventRow {
  return {
    id: overrides.id,
    source: "keeperhub",
    source_event_id: overrides.source_event_id ?? `src-${overrides.id}`,
    event_type: "liquidation",
    chain_id: overrides.chain_id ?? 11_155_111,
    protocol: overrides.protocol ?? "Aave V3",
    asset_symbols: overrides.asset_symbols ?? ["USDC"],
    magnitude: overrides.magnitude ?? { value: 40_000, unit: "USD" },
    transaction_hash: null,
    observed_at: null,
    captured_at: overrides.captured_at,
    raw_payload: {},
    status: overrides.status ?? "qualified",
    significance_score: 0.7,
    created_at: overrides.captured_at,
    updated_at: overrides.captured_at,
  };
}

function mockRepo(rows: MonitoredEventRow[], existingSourceIds: string[] = []): MonitoredEventRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findBySourceAndEventId: vi.fn(async (_source, sourceEventId) => {
      if (existingSourceIds.includes(sourceEventId)) {
        return liqRow({ id: "existing-cluster", captured_at: new Date().toISOString() });
      }
      return null;
    }),
    updateStatus: vi.fn(),
    list: vi.fn(),
    listInWindow: vi.fn(async () => ({ ok: true as const, value: rows })),
  } as unknown as MonitoredEventRepository;
}

describe("LiquidationClusterService", () => {
  // Align times inside one 30-minute floor bucket
  const windowStart = new Date("2026-07-28T12:00:00.000Z").getTime();
  const t1 = new Date(windowStart + 60_000).toISOString();
  const t2 = new Date(windowStart + 120_000).toISOString();
  const t3 = new Date(windowStart + 180_000).toISOString();
  const t4 = new Date(windowStart + 240_000).toISOString();

  it("does not synthesize with fewer than 3 liquidations", async () => {
    const service = createLiquidationClusterService(
      mockRepo([
        liqRow({ id: "1", captured_at: t1, magnitude: { value: 100_000, unit: "USD" } }),
        liqRow({ id: "2", captured_at: t2, magnitude: { value: 100_000, unit: "USD" } }),
      ]),
    );
    const result = await service.maybeSynthesize({
      chainId: 11_155_111,
      protocol: "Aave V3",
      capturedAt: t2,
    });
    expect(result).toBeNull();
  });

  it("does not synthesize when notional below $50k", async () => {
    const service = createLiquidationClusterService(
      mockRepo([
        liqRow({ id: "1", captured_at: t1, magnitude: { value: 10_000, unit: "USD" } }),
        liqRow({ id: "2", captured_at: t2, magnitude: { value: 10_000, unit: "USD" } }),
        liqRow({ id: "3", captured_at: t3, magnitude: { value: 10_000, unit: "USD" } }),
      ]),
    );
    const result = await service.maybeSynthesize({
      chainId: 11_155_111,
      protocol: "Aave V3",
      capturedAt: t3,
    });
    expect(result).toBeNull();
  });

  it("synthesizes one cluster when count ≥ 3 and notional ≥ $50k", async () => {
    const service = createLiquidationClusterService(
      mockRepo([
        liqRow({ id: "1", captured_at: t1, magnitude: { value: 30_000, unit: "USD" } }),
        liqRow({ id: "2", captured_at: t2, magnitude: { value: 40_000, unit: "USD" } }),
        liqRow({ id: "3", captured_at: t3, magnitude: { value: 50_000, unit: "USD" } }),
      ]),
    );
    const result = await service.maybeSynthesize({
      chainId: 11_155_111,
      protocol: "Aave V3",
      capturedAt: t3,
    });
    expect(result).not.toBeNull();
    expect(result!.payload.eventType).toBe("liquidation_cluster");
    expect(result!.count).toBe(3);
    expect(result!.totalUsd).toBe(120_000);
    expect(result!.payload.magnitude?.value).toBe(120_000);
    expect(result!.payload.sourceEventId).toContain("liq-cluster-11155111");
    expect(result!.payload.flowContext?.direction).toBe("de_risk");
  });

  it("is idempotent when synthetic event already exists", async () => {
    const windowStartIso = new Date(
      Math.floor(windowStart / (30 * 60_000)) * (30 * 60_000),
    ).toISOString();
    const sourceId = buildLiquidationClusterSourceEventId(
      11_155_111,
      windowStartIso,
      "Aave V3",
    );
    const service = createLiquidationClusterService(
      mockRepo(
        [
          liqRow({ id: "1", captured_at: t1, magnitude: { value: 40_000, unit: "USD" } }),
          liqRow({ id: "2", captured_at: t2, magnitude: { value: 40_000, unit: "USD" } }),
          liqRow({ id: "3", captured_at: t3, magnitude: { value: 40_000, unit: "USD" } }),
          liqRow({ id: "4", captured_at: t4, magnitude: { value: 40_000, unit: "USD" } }),
        ],
        [sourceId],
      ),
    );
    const result = await service.maybeSynthesize({
      chainId: 11_155_111,
      protocol: "Aave V3",
      capturedAt: t4,
    });
    expect(result).toBeNull();
  });
});
