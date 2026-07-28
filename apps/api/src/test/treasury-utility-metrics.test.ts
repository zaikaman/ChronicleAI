import { describe, expect, it, vi } from "vitest";
import type {
  ExecutionLogRepository,
  TreasurySnapshotRepository,
} from "@chronicleai/db";
import { createTreasuryUtilityMetricsProvider } from "../services/treasury-utility-metrics.ts";

describe("treasury-utility-metrics", () => {
  it("estimates generation and transaction costs from execution logs", async () => {
    const treasuryRepo = {
      getAggregates: vi.fn().mockResolvedValue({
        ok: true,
        value: { totalRevenue: 42, totalPaidRequests: 3, latestBalance: 1, latestStatus: "healthy" },
      }),
    } as unknown as TreasurySnapshotRepository;

    const execLogRepo = {
      listRecent: vi.fn().mockResolvedValue({
        ok: true,
        value: [
          {
            id: "1",
            action_type: "generate_alert",
            status: "succeeded",
            created_at: "2026-07-01T00:00:00.000Z",
          },
          {
            id: "2",
            action_type: "generate_digest",
            status: "succeeded",
            created_at: "2026-07-02T00:00:00.000Z",
          },
          {
            id: "3",
            action_type: "registry_write",
            status: "succeeded",
            created_at: "2026-07-03T00:00:00.000Z",
          },
          {
            id: "4",
            action_type: "registry_write",
            status: "failed",
            created_at: "2026-07-04T00:00:00.000Z",
          },
        ],
      }), listPage: vi.fn()
    } as unknown as ExecutionLogRepository;

    const provider = createTreasuryUtilityMetricsProvider({
      treasuryRepo,
      execLogRepo,
      costs: { costPerGenerationUsdc: 0.02, costPerRegistryWriteUsdc: 0.05 },
    });

    const metrics = await provider.collect();
    expect(metrics.paidRequestCount).toBe(3);
    expect(metrics.revenueTotal).toBe(42);
    expect(metrics.generationActionCount).toBe(2);
    expect(metrics.registryWriteCount).toBe(1);
    expect(metrics.failedRegistryWriteCount).toBe(1);
    expect(metrics.estimatedGenerationCost).toBe(0.04);
    expect(metrics.estimatedTransactionCost).toBe(0.05);
    expect(metrics.auditLines.length).toBeGreaterThan(0);
  });
});
