import { describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { createActivityRoutes } from "../routes/activity-routes.ts";
import type { AgentActivityService } from "../services/agent-activity-service.ts";
import type {
  ExecutionLogRepository,
  PaymentRecordRepository,
  PayoutRecordRepository,
} from "@chronicleai/db";
import { success } from "@chronicleai/db";

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

describe("GET /activity/stats/badge", () => {
  it("returns Shields.io dynamic endpoint payload with execution count", async () => {
    const mockActivityService = {
      getActivity: async () => ({ success: true, data: {} as any }),
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
    } as unknown as ExecutionLogRepository;

    const mockPaymentRecordRepo = {} as PaymentRecordRepository;
    const mockPayoutRepo = {} as PayoutRecordRepository;

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
        const res = await fetch(`${baseUrl}/activity/stats/badge`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data).toEqual({
          schemaVersion: 1,
          label: "KeeperHub Txs",
          message: "42 Executed",
          color: "blueviolet",
        });
      },
    );
  });
});
