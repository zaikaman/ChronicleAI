import type { AddressInfo } from "node:net";
import type { ServerEnv } from "@chronicleai/config";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createKeeperhubMarketplaceProxyRoutes } from "../routes/keeperhub-marketplace-proxy-routes.ts";

const clientFetch = globalThis.fetch;
const env = {
  keeperhubApiBaseUrl: "https://keeperhub.example",
  keeperhubApiKey: "server-api-key",
} as ServerEnv;

async function withProxyServer(fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(createKeeperhubMarketplaceProxyRoutes(env));

  const server = await new Promise<import("node:http").Server>((resolve) => {
    const nextServer = app.listen(0, "127.0.0.1", () => resolve(nextServer));
  });

  try {
    const address = server.address() as AddressInfo;
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("KeeperHub Marketplace Watch proxy", () => {
  it("forwards MPP Payment authorization instead of replacing it with the server key", async () => {
    const upstreamFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ executionId: "exec-mpp" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Payment-Receipt": "receipt-mpp",
          "WWW-Authenticate": "Payment realm=keeperhub",
        },
      }),
    );

    await withProxyServer(async (baseUrl) => {
      const response = await clientFetch(`${baseUrl}/keeperhub/marketplace/watch/call`, {
        method: "POST",
        headers: {
          Authorization: "Payment mpp-credential",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ targetContract: "0x0000000000000000000000000000000000000001" }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Payment-Receipt")).toBe("receipt-mpp");
      expect(response.headers.get("WWW-Authenticate")).toBe("Payment realm=keeperhub");
      expect(upstreamFetch).toHaveBeenCalledWith(
        "https://keeperhub.example/api/mcp/workflows/chronicleai-paid-onchain-watch-v2/call",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Payment mpp-credential",
            "Content-Type": "application/json",
          }),
        }),
      );
    });
  });

  it("keeps the server API key for browser calls without an MPP credential", async () => {
    const upstreamFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ executionId: "exec-x402" }), { status: 200 }),
      );

    await withProxyServer(async (baseUrl) => {
      const response = await clientFetch(`${baseUrl}/keeperhub/marketplace/watch/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetContract: "0x0000000000000000000000000000000000000001" }),
      });

      expect(response.status).toBe(200);
      expect(upstreamFetch).toHaveBeenCalledWith(
        "https://keeperhub.example/api/mcp/workflows/chronicleai-paid-onchain-watch-v2/call",
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: "Bearer server-api-key" }),
        }),
      );
    });
  });
});
