import { describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { errorHandler } from "../middleware/core.ts";
import type { TreasuryCheckHandler } from "../keeperhub/treasury-check-handler.ts";
import { createKeeperhubTreasuryRoutes } from "../routes/keeperhub-treasury-routes.ts";

async function withServer(
  handler: TreasuryCheckHandler,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(createKeeperhubTreasuryRoutes(handler));
  app.use(errorHandler);

  const server = await new Promise<import("node:http").Server>((resolve) => {
    const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
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

describe("KeeperHub treasury routes", () => {
  it("does not expose unexpected error details to callers", async () => {
    const check = vi.fn().mockRejectedValue(new Error("database password leaked"));
    const handler = { check } as unknown as TreasuryCheckHandler;

    await withServer(handler, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/keeperhub/treasury/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capturedAt: "2026-08-01T00:00:00.000Z",
          availableBalance: 1,
          currency: "USDC",
        }),
      });

      expect(response.status).toBe(500);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toEqual({ error: "Internal server error" });
      expect(body).not.toHaveProperty("stack");
      expect(JSON.stringify(body)).not.toContain("database password leaked");
      expect(check).toHaveBeenCalledOnce();
    });
  });
});
