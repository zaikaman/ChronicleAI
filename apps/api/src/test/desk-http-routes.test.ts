import { describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { createDeskRoutes } from "../routes/desk-routes.ts";
import { createKeeperhubDeskRoutes } from "../routes/keeperhub-desk-routes.ts";
import { createPremiumDeskRoutes } from "../routes/premium-desk-routes.ts";
import { errorHandler } from "../middleware/core.ts";
import type { DeskControlPlane } from "../desk/control-plane.ts";
import type { DeskSignalIngestService } from "../desk/signal-ingest-service.ts";
import type { DeskFeedAccessGate } from "../desk/desk-feed-product.ts";
import type { DeskIntentRow, DeskTicketRow } from "@chronicleai/db";

function sampleIntent(): DeskIntentRow {
  return {
    id: "intent-1",
    signal_id: "sig-1",
    strategy: "oracle_amm",
    status: "filled",
    notional_usdc: 12,
    legs: [{ protocol: "uniswap-v3", action: "exactInputSingle" }],
    reason_codes: ["basis_edge"],
    policy_snapshot: { maxTradeUsdc: 15, basisBps: 50 },
    keeper_hub_run_id: "run-1",
    error_message: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:01.000Z",
  };
}

function sampleTicket(): DeskTicketRow {
  return {
    id: "ticket-1",
    intent_id: "intent-1",
    ticket_hash: "0xabc",
    signal_hash: "0xsig",
    intent_hash: "0xint",
    content_uri: "https://app.example/desk/tickets/ticket-1",
    tx_hash: "0xtx",
    keeper_hub_run_id: "run-1",
    explorer_url: "https://sepolia.etherscan.io/tx/0xtx",
    summary: "Desk oracle_amm",
    payload: { version: 1, strategy: "oracle_amm", legs: [] },
    created_at: "2026-07-01T00:00:02.000Z",
  };
}

function mockControlPlane(overrides: Partial<DeskControlPlane> = {}): DeskControlPlane {
  const base: DeskControlPlane = {
    async runCapitalTick() {
      return {
        mark: null,
        treasuryUsdc: 40,
        treasuryEth: 0.2,
        capital: {
          decision: { action: "none", amountUsdc: 0, reason: "no_action" },
        },
      };
    },
    async runDeskTick() {
      return {
        heartbeat: {
          id: "hb-1",
          source: "api",
          created_at: new Date().toISOString(),
        },
        mark: null,
        evaluations: [],
        executions: [],
      };
    },
    async runAgentOnly() {
      return {
        proposal: {
          version: 1 as const,
          action: "hold" as const,
          strategy: null,
          notionalUsdc: 0,
          priority: 0,
          confidence: 0,
          thesis: "test",
          riskNotes: [],
          legsHint: ["none" as const],
          declineReasons: [],
        },
        agentRunId: null,
        context: {} as never,
        safeDefault: true,
      };
    },
    async applyExecutionResult() {
      return { intent: sampleIntent() };
    },
    async armKill() {
      return {
        state: {
          armed: true,
          armedAt: new Date().toISOString(),
          armedReason: "test",
          lastTripAt: null,
          lastTripReason: null,
          lastKeeperHubRunId: null,
          lastTxHash: null,
        },
      };
    },
    async getStatus() {
      return {
        chainId: 11155111,
        deskWalletAddress: "0xdesk",
        treasuryWalletAddress: "0xtreasury",
        equityUsdc: 45,
        freeUsdc: 20,
        targetAumUsdc: 50,
        maxAumUsdc: 80,
        minAumUsdc: 20,
        healthFactor: 2.1,
        paused: false,
        killSwitch: {
          armed: false,
          armedAt: null,
          armedReason: null,
          lastTripAt: null,
          lastTripReason: null,
          lastKeeperHubRunId: null,
          lastTxHash: null,
        },
        heartbeat: {
          lastSeenAt: "2026-07-01T00:00:00.000Z",
          ageMs: 1000,
          stale: false,
          killEligible: false,
          source: "api",
        },
        lastPositionAsOf: "2026-07-01T00:00:00.000Z",
        lastTopupAt: null,
        lastSweepAt: null,
        policy: {
          maxTradeUsdc: 15,
          hfWarn: 1.5,
          hfCritical: 1.2,
          basisBps: 50,
          apyDeltaBps: 50,
        },
        lastAgent: null,
        agentEnabled: false,
        agentBlockedReason: "no_llm_provider_configured",
      };
    },
    async getLatestAgent() {
      return null;
    },
    async getLatestPosition() {
      return null;
    },
    isAgentEnabled() {
      return false;
    },
    getAgentBlockedReason() {
      return "no_llm_provider_configured";
    },
    async markLive() {
      throw new Error("no rpc");
    },
    async listIntents() {
      return [sampleIntent()];
    },
    async listIntentsPage(params) {
      const page = params?.page ?? 1;
      const limit = params?.limit ?? 20;
      const items = [sampleIntent()];
      return {
        items,
        page,
        limit,
        total: items.length,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      };
    },
    async listTickets() {
      return [sampleTicket()];
    },
    async listTicketsPage(params) {
      const page = params?.page ?? 1;
      const limit = params?.limit ?? 15;
      const items = [sampleTicket()];
      return {
        items,
        page,
        limit,
        total: items.length,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      };
    },
    async getTicket(id) {
      return id === "ticket-1" ? sampleTicket() : null;
    },
    async findTicketBySignalHash(signalHash) {
      return signalHash === "0xsig" ? sampleTicket() : null;
    },
    async findTicketByIntentId(intentId) {
      return intentId === "intent-1" ? sampleTicket() : null;
    },
    async listCapitalMoves() {
      return [];
    },
    async listCapitalMovesPage(params) {
      const page = params?.page ?? 1;
      const limit = params?.limit ?? 15;
      return {
        items: [],
        page,
        limit,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      };
    },
    getKillState() {
      return {
        armed: false,
        armedAt: null,
        armedReason: null,
        lastTripAt: null,
        lastTripReason: null,
        lastKeeperHubRunId: null,
        lastTxHash: null,
      };
    },
    getConfig() {
      return {
        targetAumUsdc: 50,
        maxAumUsdc: 80,
        minAumUsdc: 20,
        topupChunkUsdc: 10,
        minFreeUsdc: 10,
        inventoryTopupUsdc: 10,
        preferUnwindForFreeUsdc: true,
        profitSweepUsdc: 15,
        topupCooldownMs: 3_600_000,
    postMaintenanceSweepCooldownMs: 1_200_000,
        hfWarn: 1.5,
        hfCritical: 1.2,
        basisBps: 50,
        apyDeltaBps: 50,
        maxTradeUsdc: 15,
        killHeartbeatMs: 6 * 60 * 60_000,
        failedRunCooldownMs: 15 * 60_000,
        oracleMaxStalenessMs: 60 * 60_000,
        apyConsecutivePolls: 2,
        apyAbsurdBps: 5000,
        rebalanceIntervalMs: 21600000,
        maintenanceNotionalUsdc: 10,
        eventMicrotradeEnabled: false,
        eventMicrotradeUsdc: 5,
        eventMicrotradeCooldownMs: 3_600_000,
        eventMicrotradeLookbackMs: 3_600_000,
        gasElevatedGwei: 50,
        paused: false,
      };
    },
    getDeskWalletAddress: () => "0xdesk",
    getTreasuryWalletAddress: () => "0xtreasury",
  };
  return { ...base, ...overrides };
}

async function withServer(
  mount: (app: express.Express) => void,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  mount(app);
  app.use(errorHandler);
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

describe("Phase 10 HTTP surface", () => {
  it("GET /desk/status returns equity and kill state", async () => {
    const plane = mockControlPlane();
    await withServer(
      (app) => {
        app.use(createDeskRoutes(plane));
      },
      async (base) => {
        const res = await fetch(`${base}/desk/status`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as { equityUsdc: number; chainId: number };
        expect(body.equityUsdc).toBe(45);
        expect(body.chainId).toBe(11155111);
      },
    );
  });

  it("GET /desk/intents returns public summary without legs", async () => {
    const plane = mockControlPlane();
    await withServer(
      (app) => {
        app.use(createDeskRoutes(plane));
      },
      async (base) => {
        const res = await fetch(`${base}/desk/intents`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          intents: Array<Record<string, unknown>>;
        };
        expect(body.intents).toHaveLength(1);
        expect(body.intents[0]?.legCount).toBe(1);
        expect(body.intents[0]?.legs).toBeUndefined();
      },
    );
  });

  it("GET /desk/tickets lists narrative tickets", async () => {
    const plane = mockControlPlane();
    await withServer(
      (app) => {
        app.use(createDeskRoutes(plane));
      },
      async (base) => {
        const res = await fetch(`${base}/desk/tickets`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          tickets: Array<{ id: string; strategy: string | null; payload?: unknown }>;
        };
        expect(body.tickets).toHaveLength(1);
        expect(body.tickets[0]?.id).toBe("ticket-1");
        expect(body.tickets[0]?.strategy).toBe("oracle_amm");
        expect(body.tickets[0]?.payload).toBeUndefined();
      },
    );
  });

  it("GET /desk/tickets?signalHash= resolves desk-acted ticket", async () => {
    const plane = mockControlPlane();
    await withServer(
      (app) => {
        app.use(createDeskRoutes(plane));
      },
      async (base) => {
        const hit = await fetch(`${base}/desk/tickets?signalHash=0xsig`);
        expect(hit.status).toBe(200);
        const hitBody = (await hit.json()) as { tickets: Array<{ id: string }> };
        expect(hitBody.tickets).toHaveLength(1);

        const miss = await fetch(`${base}/desk/tickets?signalHash=0xmissing`);
        expect(miss.status).toBe(200);
        const missBody = (await miss.json()) as { tickets: unknown[] };
        expect(missBody.tickets).toHaveLength(0);
      },
    );
  });

  it("GET /desk/tickets/:id returns proofs", async () => {
    const plane = mockControlPlane();
    await withServer(
      (app) => {
        app.use(createDeskRoutes(plane));
      },
      async (base) => {
        const res = await fetch(`${base}/desk/tickets/ticket-1`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          proofs: { txHash: string };
          ticket: { payload?: unknown; strategy?: string | null };
        };
        expect(body.proofs.txHash).toBe("0xtx");
        expect(body.ticket.payload).toBeUndefined();
        expect(body.ticket.strategy).toBe("oracle_amm");
      },
    );
  });

  it("signed capital / tick / kill endpoints respond", async () => {
    const plane = mockControlPlane();
    const signalIngest: DeskSignalIngestService = {
      async ingest() {
        return {
          accepted: true,
          statusCode: 202,
          message: "ok",
          deduped: false,
        };
      },
    };

    await withServer(
      (app) => {
        app.use(createKeeperhubDeskRoutes({ signalIngest, controlPlane: plane }));
      },
      async (base) => {
        const capital = await fetch(`${base}/keeperhub/desk/capital`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        expect(capital.status).toBe(200);
        const capitalBody = (await capital.json()) as { decision: { action: string } };
        expect(capitalBody.decision.action).toBe("none");

        const tick = await fetch(`${base}/keeperhub/desk/tick`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: "api" }),
        });
        expect(tick.status).toBe(200);

        const kill = await fetch(`${base}/keeperhub/desk/kill`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "unit_test" }),
        });
        expect(kill.status).toBe(200);
        const killBody = (await kill.json()) as { state: { armed: boolean } };
        expect(killBody.state.armed).toBe(true);
      },
    );
  });

  it("premium desk feed returns 402 without receipt", async () => {
    const plane = mockControlPlane();
    const gate: DeskFeedAccessGate = {
      async ensureProduct() {
        return {
          id: "product-1",
          slug: "chronicle-desk-feed",
          title: "Chronicle Desk Feed",
          content_type: "structured_feed",
          summary_public: "feed",
          content_private: {},
          source_event_ids: [],
          price_amount: 0.5,
          price_currency: "USDC",
          payment_routes: ["x402"],
          status: "available",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      },
      async verifyAccess() {
        return {
          allowed: false,
          product: await this.ensureProduct(),
          reason: "missing_receipt",
        };
      },
    };

    await withServer(
      (app) => {
        app.use(createPremiumDeskRoutes({ controlPlane: plane, deskFeedGate: gate }));
      },
      async (base) => {
        const res = await fetch(`${base}/premium/desk/intents`);
        expect(res.status).toBe(402);
        const body = (await res.json()) as {
          premiumItemId: string;
          priceAmount: number;
        };
        expect(body.premiumItemId).toBe("product-1");
        expect(body.priceAmount).toBe(0.5);
      },
    );
  });

  it("premium desk feed returns full intent legs with access", async () => {
    const plane = mockControlPlane();
    const gate: DeskFeedAccessGate = {
      async ensureProduct() {
        return {
          id: "product-1",
          slug: "chronicle-desk-feed",
          title: "Chronicle Desk Feed",
          content_type: "structured_feed",
          summary_public: "feed",
          content_private: {},
          source_event_ids: [],
          price_amount: 0.5,
          price_currency: "USDC",
          payment_routes: ["x402"],
          status: "available",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      },
      async verifyAccess() {
        return {
          allowed: true,
          product: await this.ensureProduct(),
          paymentRecordId: "pay-1",
        };
      },
    };

    await withServer(
      (app) => {
        app.use(createPremiumDeskRoutes({ controlPlane: plane, deskFeedGate: gate }));
      },
      async (base) => {
        const intentsRes = await fetch(`${base}/premium/desk/intents`);
        expect(intentsRes.status).toBe(200);
        const intentsBody = (await intentsRes.json()) as {
          intents: Array<{ legs: unknown[] }>;
        };
        expect(intentsBody.intents[0]?.legs).toHaveLength(1);

        const ticketRes = await fetch(`${base}/premium/desk/tickets/ticket-1`);
        expect(ticketRes.status).toBe(200);
        const ticketBody = (await ticketRes.json()) as {
          ticket: { payload: { version: number } };
        };
        expect(ticketBody.ticket.payload.version).toBe(1);

        const streamRes = await fetch(`${base}/premium/desk/stream`);
        expect(streamRes.status).toBe(200);
        const streamBody = (await streamRes.json()) as { feed: string };
        expect(streamBody.feed).toBe("chronicle-desk");
      },
    );
  });
});
