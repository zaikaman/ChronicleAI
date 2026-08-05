import type { ExecutionLogRepository } from "@chronicleai/db";
import { describe, expect, it, vi } from "vitest";
import { RevenueRoutingHandler } from "../keeperhub/revenue-routing-handler.ts";
import type { RevenueRoutingService } from "../services/revenue-routing-service.ts";

function createHandler(result: Awaited<ReturnType<RevenueRoutingService["routeRevenue"]>>) {
  const append = vi.fn().mockResolvedValue({ ok: true, value: {} });
  const routingService: RevenueRoutingService = {
    routeRevenue: vi.fn().mockResolvedValue(result),
  };
  const handler = new RevenueRoutingHandler({
    routingService,
    execLogRepo: { append } as unknown as ExecutionLogRepository,
  });

  return { append, handler };
}

describe("RevenueRoutingHandler", () => {
  it("records interval-gated runs as skipped instead of failed", async () => {
    const { append, handler } = createHandler({
      outcome: "skipped",
      routed: false,
      totalRevenue: 250,
      creatorRecoveryAmount: 0,
      referralRewardsAmount: 0,
      payoutPeriodHash: "period-1",
      payoutIds: [],
      errorMessage: "Routing interval not elapsed (1000ms < 60000ms ROUTING_INTERVAL_MS)",
    });

    const response = await handler.route({ periodHash: "period-1" }, "scheduler");

    expect(response).toEqual({
      accepted: true,
      statusCode: 202,
      payoutCount: 0,
      message: expect.stringContaining("Revenue routing skipped"),
    });
    expect(append).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        status: "skipped",
        message: expect.stringContaining("Routing interval not elapsed"),
        details: expect.objectContaining({ skipped: true }),
      }),
    );
  });

  it("keeps actual routing failures as failed", async () => {
    const { append, handler } = createHandler({
      outcome: "failed",
      routed: false,
      totalRevenue: 250,
      creatorRecoveryAmount: 0,
      referralRewardsAmount: 0,
      payoutPeriodHash: "period-2",
      payoutIds: [],
      errorMessage: "On-chain USDC transfer failed: insufficient funds",
    });

    const response = await handler.route({ periodHash: "period-2" });

    expect(response).toEqual({
      accepted: false,
      statusCode: 500,
      payoutCount: 0,
      message: expect.stringContaining("Revenue routing failed"),
    });
    expect(append).toHaveBeenNthCalledWith(2, expect.objectContaining({ status: "failed" }));
  });
});
