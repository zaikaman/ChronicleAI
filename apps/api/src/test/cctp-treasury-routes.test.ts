import { describe, expect, it, vi } from "vitest";
import express, { type Request } from "express";
import type { AddressInfo } from "node:net";
import { createTreasuryCctpRoutes } from "../routes/treasury-cctp-routes.ts";
import {
  computeKeeperhubSignature,
  keeperhubSignatureMiddleware,
} from "../middleware/keeperhub-signature.ts";
import { errorHandler } from "../middleware/core.ts";
import type { CctpRebalanceService } from "../cctp/rebalance-service.ts";
import type { CctpRebalanceTransferRow } from "@chronicleai/db";
import { randomBytes } from "node:crypto";

const SECRET = "test-keeperhub-webhook-secret-32chars!";

function sampleTransfer(
  overrides: Partial<CctpRebalanceTransferRow> = {},
): CctpRebalanceTransferRow {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    status: "minted",
    direction: "base_to_sepolia",
    source_domain: 6,
    destination_domain: 0,
    source_chain_id: 84532,
    destination_chain_id: 11155111,
    amount_usdc: 10,
    amount_atomic: "10000000",
    max_fee_atomic: "50000",
    min_finality_threshold: 1000,
    mode: "direct",
    treasury_address: "0x1111111111111111111111111111111111111111",
    mint_recipient: "0x1111111111111111111111111111111111111111",
    approve_tx_hash: "0x" + "a".repeat(64),
    burn_tx_hash: "0x" + "b".repeat(64),
    message_bytes: "0xmsg",
    attestation: "0xatt",
    message_hash: "0x" + "c".repeat(64),
    mint_tx_hash: "0x" + "d".repeat(64),
    iris_status: "complete",
    error_message: null,
    attempt_count: 0,
    burned_at: "2026-07-28T00:00:00.000Z",
    attested_at: "2026-07-28T00:01:00.000Z",
    minted_at: "2026-07-28T00:02:00.000Z",
    created_at: "2026-07-28T00:00:00.000Z",
    updated_at: "2026-07-28T00:02:00.000Z",
    metadata: { feeQuote: { minimumFee: 1 } },
    ...overrides,
  };
}

function mockService(
  overrides: Partial<CctpRebalanceService> = {},
): CctpRebalanceService {
  return {
    async getStatus() {
      return {
        enabled: true,
        inFlightCount: 0,
        inFlightUsdc: 0,
        lastSuccessfulBurnAt: "2026-07-28T00:00:00.000Z",
        recent: [sampleTransfer()],
        balances: {
          treasuryBaseUsdc: 25,
          treasurySepoliaUsdc: 5,
          treasuryBaseEth: 0.02,
          treasurySepoliaEth: 0.05,
          inFlightUsdc: 0,
        },
        policy: {
          eligible: true,
          amountUsdc: 10,
          amountAtomic: "10000000",
          maxFeeAtomic: "50000",
          reason: "eligible",
          detail: "ok",
          availableAboveBufferUsdc: 20,
        },
      };
    },
    async forceRebalance(amountUsdc?: number) {
      return {
        outcome: "burned",
        transferId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        status: "awaiting_attestation",
        amountUsdc: amountUsdc ?? 10,
        mode: "direct",
        burnTxHash: "0x" + "e".repeat(64),
      };
    },
    async resumeInFlight() {
      return {
        processed: 1,
        results: [
          {
            transferId: "11111111-2222-3333-4444-555555555555",
            outcome: "minted",
            status: "minted",
            burnTxHash: "0x" + "b".repeat(64),
            mintTxHash: "0x" + "d".repeat(64),
          },
        ],
      };
    },
    async tick() {
      return { outcome: "skipped", reason: "cooldown" };
    },
    async readBalances() {
      return {
        treasuryBaseUsdc: 25,
        treasurySepoliaUsdc: 5,
        treasuryBaseEth: 0.02,
        treasurySepoliaEth: 0.05,
        inFlightUsdc: 0,
      };
    },
    ...overrides,
  };
}

async function withServer(
  mount: (app: express.Express) => void,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, body) => {
        (req as Request).rawBody = Buffer.from(body);
      },
    }),
  );
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

function signedHeaders(
  path: string,
  method = "GET",
  body = "",
  extra: Record<string, string> = {},
): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(16).toString("hex");
  return {
    "X-ChronicleAI-Timestamp": String(timestamp),
    "X-ChronicleAI-Nonce": nonce,
    "X-ChronicleAI-Signature": computeKeeperhubSignature({
      secret: SECRET,
      method,
      path,
      body,
      timestamp,
      nonce,
    }),
    ...extra,
  };
}

describe("treasury CCTP routes", () => {
  function mountCctp(
    app: express.Express,
    service: CctpRebalanceService | null,
  ): void {
    // Mirror production: path-scoped auth so other routes stay public.
    app.use("/treasury/cctp", keeperhubSignatureMiddleware(SECRET));
    app.use(createTreasuryCctpRoutes({ service }));
  }

  it("rejects requests without signature", async () => {
    await withServer(
      (app) => {
        mountCctp(app, mockService());
      },
      async (base) => {
        const res = await fetch(`${base}/treasury/cctp/status`);
        expect(res.status).toBe(401);
      },
    );
  });

  it("GET /treasury/cctp/status returns dual balances and policy", async () => {
    await withServer(
      (app) => {
        mountCctp(app, mockService());
      },
      async (base) => {
        const res = await fetch(`${base}/treasury/cctp/status`, {
          headers: signedHeaders("/treasury/cctp/status"),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          enabled: boolean;
          balances: { treasuryBaseUsdc: number; treasurySepoliaUsdc: number };
          policy: { eligible: boolean; amountUsdc: number };
          recent: Array<{ id: string; burnExplorerUrl: string | null }>;
        };
        expect(body.enabled).toBe(true);
        expect(body.balances.treasuryBaseUsdc).toBe(25);
        expect(body.balances.treasurySepoliaUsdc).toBe(5);
        expect(
          (body.balances as { deployableToDeskUsdc?: number }).deployableToDeskUsdc,
        ).toBeDefined();
        expect(body.policy.eligible).toBe(true);
        expect(body.policy.amountUsdc).toBe(10);
        expect(body.recent).toHaveLength(1);
        expect(body.recent[0]?.id).toBe("11111111-2222-3333-4444-555555555555");
        expect(body.recent[0]?.burnExplorerUrl).toContain("basescan");
      },
    );
  });

  it("POST /treasury/cctp/rebalance force-calls service with amount", async () => {
    const forceRebalance = vi.fn().mockResolvedValue({
      outcome: "burned",
      transferId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      status: "awaiting_attestation",
      amountUsdc: 1,
      mode: "direct",
      burnTxHash: "0x" + "e".repeat(64),
    });
    await withServer(
      (app) => {
        mountCctp(app, mockService({ forceRebalance }));
      },
      async (base) => {
        const payload = JSON.stringify({ amountUsdc: 1 });
        const res = await fetch(`${base}/treasury/cctp/rebalance`, {
          method: "POST",
          headers: {
            ...signedHeaders("/treasury/cctp/rebalance", "POST", payload),
            "Content-Type": "application/json",
          },
          body: payload,
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          ok: boolean;
          forced: boolean;
          outcome: string;
          amountUsdc: number;
          amountUsdcRequested: number;
          burnTxHash: string;
        };
        expect(forceRebalance).toHaveBeenCalledWith(1);
        expect(body.ok).toBe(true);
        expect(body.forced).toBe(true);
        expect(body.outcome).toBe("burned");
        expect(body.amountUsdcRequested).toBe(1);
        expect(body.burnTxHash).toMatch(/^0xe+/);
      },
    );
  });

  it("POST /treasury/cctp/rebalance rejects invalid amountUsdc", async () => {
    await withServer(
      (app) => {
        mountCctp(app, mockService());
      },
      async (base) => {
        const payload = JSON.stringify({ amountUsdc: -1 });
        const res = await fetch(`${base}/treasury/cctp/rebalance`, {
          method: "POST",
          headers: {
            ...signedHeaders("/treasury/cctp/rebalance", "POST", payload),
            "Content-Type": "application/json",
          },
          body: payload,
        });
        expect(res.status).toBe(400);
      },
    );
  });

  it("POST /treasury/cctp/resume returns processed results", async () => {
    const resumeInFlight = vi.fn().mockResolvedValue({
      processed: 1,
      results: [
        {
          transferId: "11111111-2222-3333-4444-555555555555",
          outcome: "minted",
          status: "minted",
          mintTxHash: "0x" + "d".repeat(64),
        },
      ],
    });
    await withServer(
      (app) => {
        mountCctp(app, mockService({ resumeInFlight }));
      },
      async (base) => {
        const res = await fetch(`${base}/treasury/cctp/resume`, {
          method: "POST",
          headers: signedHeaders("/treasury/cctp/resume", "POST"),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          ok: boolean;
          processed: number;
          results: Array<{ outcome: string }>;
        };
        expect(resumeInFlight).toHaveBeenCalledOnce();
        expect(body.ok).toBe(true);
        expect(body.processed).toBe(1);
        expect(body.results[0]?.outcome).toBe("minted");
      },
    );
  });

  it("returns 503 when service is not configured", async () => {
    await withServer(
      (app) => {
        mountCctp(app, null);
      },
      async (base) => {
        const res = await fetch(`${base}/treasury/cctp/status`, {
          headers: signedHeaders("/treasury/cctp/status"),
        });
        expect(res.status).toBe(503);
        const body = (await res.json()) as { error: string };
        expect(body.error).toMatch(/not configured/i);
      },
    );
  });
});
