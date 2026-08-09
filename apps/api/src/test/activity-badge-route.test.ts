import type { AddressInfo } from "node:net";
import type {
  ExecutionLogRepository,
  PaymentRecordRepository,
  PayoutRecordRepository,
} from "@chronicleai/db";
import { success } from "@chronicleai/db";
import express from "express";
import { describe, expect, it, vi } from "vitest";
import { createActivityRoutes } from "../routes/activity-routes.ts";
import type { AgentActivityService } from "../services/agent-activity-service.ts";

async function withServer(
  mount: (app: express.Express) => void,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  mount(app);
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const addr = server.address() as AddressInfo;
    await fn(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

describe("GET /activity stats & badge endpoints", () => {
  const mockActivityService = {
    getActivity: async () => ({ success: true }),
  } as AgentActivityService;

  const mockExecLogRepo = {
    listPage: async () =>
      success({
        items: [],
        page: 1,
        limit: 1,
        total: 42,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      }),
    countHackathonExecutions: async () => success(15),
  } as unknown as ExecutionLogRepository;

  const mockPaymentRecordRepo = {} as PaymentRecordRepository;
  const mockPayoutRepo = {} as PayoutRecordRepository;

  it("GET /activity/stats/count returns hackathon window count JSON", async () => {
    await withServer(
      (app) => {
        app.use(
          createActivityRoutes({
            activityService: mockActivityService,
            execLogRepo: mockExecLogRepo,
            paymentRecordRepo: mockPaymentRecordRepo,
            payoutRepo: mockPayoutRepo,
          }),
        );
      },
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/activity/stats/count`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data).toEqual({
          count: 15,
          startDate: "2026-07-27",
          endDate: "2026-08-13",
          window: "July 27 - August 13, 2026",
        });
      },
    );
  });

  it("GET /activity/badge.svg returns dynamic SVG image payload", async () => {
    await withServer(
      (app) => {
        app.use(
          createActivityRoutes({
            activityService: mockActivityService,
            execLogRepo: mockExecLogRepo,
            paymentRecordRepo: mockPaymentRecordRepo,
            payoutRepo: mockPayoutRepo,
          }),
        );
      },
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/activity/badge.svg`);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("image/svg+xml");
        const text = await res.text();
        expect(text).toContain("<svg");
        expect(text).toContain("15 LIVE");
      },
    );
  });

  it("batches failed payment diagnostics and uses a planned pagination count", async () => {
    const paymentId = "11111111-1111-4111-8111-111111111111";
    const listPage = vi.fn(async (params: { countMode?: string }) =>
      success({
        items: [
          {
            id: paymentId,
            premium_item_id: "premium-1",
            payment_route: "x402",
            status: "failed",
            amount_requested: 5,
            amount_settled: null,
            currency: "USDC",
            referral_address: null,
            requested_at: "2026-08-01T00:00:00.000Z",
            settled_at: null,
            settlement_reference: null,
            registry_tx_hash: null,
            keeper_hub_run_id: null,
            explorer_url: null,
            content_uri: null,
          },
        ],
        page: 1,
        limit: 20,
        total: params.countMode === "planned" ? 1 : 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      }),
    );
    const listByEntity = vi.fn(async () => {
      throw new Error("per-record lookups are not allowed");
    });
    const listFailedByEntityIds = vi.fn(async () =>
      success([
        {
          entity_id: paymentId,
          status: "failed",
          message: "insufficient funds",
          details: {},
        },
      ]),
    );

    await withServer(
      (app) => {
        app.use(
          createActivityRoutes({
            activityService: mockActivityService,
            execLogRepo: {
              listPage: async () =>
                success({
                  items: [],
                  page: 1,
                  limit: 1,
                  total: 0,
                  totalPages: 0,
                  hasNextPage: false,
                  hasPreviousPage: false,
                }),
              listByEntity,
              listFailedByEntityIds,
            } as unknown as ExecutionLogRepository,
            paymentRecordRepo: { listPage } as unknown as PaymentRecordRepository,
            payoutRepo: {} as PayoutRecordRepository,
          }),
        );
      },
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/activity/payments?page=1&limit=20`);
        expect(res.status).toBe(200);
        const data = (await res.json()) as {
          items: Array<{ failureReason?: string }>;
        };
        expect(data.items[0]?.failureReason).toBe(
          "The payer wallet did not have enough USDC to cover this charge.",
        );
        expect(listPage).toHaveBeenCalledWith({ page: 1, limit: 20, countMode: "planned" });
        expect(listFailedByEntityIds).toHaveBeenCalledWith(
          "payment_record",
          [paymentId],
          10,
        );
        expect(listFailedByEntityIds).toHaveBeenCalledTimes(1);
        expect(listByEntity).not.toHaveBeenCalled();
      },
    );
  });

  it("GET /transactions.txt returns formatted plain text chronological log", async () => {
    const listAllChronological = vi.fn().mockResolvedValue(
      success({
        items: [
          {
            id: "log-1",
            action_type: "publish_alert",
            status: "succeeded",
            message: "Alert published on-chain",
            details: { keeper_hub_run_id: "kh_run_001", txHash: "0xabc123" },
            created_at: "2026-07-27T10:00:00.000Z",
          },
        ],
        total: 29541,
        page: 1,
        limit: 100,
        totalPages: 296,
      }),
    );

    await withServer(
      (app) => {
        app.use(
          createActivityRoutes({
            activityService: mockActivityService,
            execLogRepo: {
              ...mockExecLogRepo,
              listAllChronological,
            } as unknown as ExecutionLogRepository,
            paymentRecordRepo: mockPaymentRecordRepo,
            payoutRepo: mockPayoutRepo,
          }),
        );
      },
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/transactions.txt`);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("text/plain");
        const text = await res.text();
        expect(text).toContain("CHRONICLE AI — KEEPERHUB TRANSACTIONS");
        expect(text).toContain("Total Transactions Executed: 29541");
        expect(text).toContain("Showing: Page 1 of 296");
        expect(text).toContain("#1 | [2026-07-27T10:00:00.000Z]");
        expect(text).toContain("Action: publish_alert");
        expect(text).toContain("KeeperHub Run ID: kh_run_001");
        expect(text).toContain("Tx Hash: 0xabc123");
      },
    );
  });
});
