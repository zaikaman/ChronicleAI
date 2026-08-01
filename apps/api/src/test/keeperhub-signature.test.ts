import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import express, { type Request } from "express";
import { describe, expect, it } from "vitest";
import { errorHandler } from "../middleware/core.ts";
import {
  computeKeeperhubSignature,
  keeperhubSignatureMiddleware,
} from "../middleware/keeperhub-signature.ts";

const SECRET = "test-keeperhub-webhook-secret-32chars!";

async function withServer(
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
  app.use(keeperhubSignatureMiddleware(SECRET));
  app.use((_req, res) => res.status(204).end());
  app.use(errorHandler);

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

function signedHeaders(
  path: string,
  method = "GET",
  body = "",
  timestamp = Math.floor(Date.now() / 1000),
  nonce = randomBytes(16).toString("hex"),
): Record<string, string> {
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
  };
}

describe("KeeperHub signature middleware", () => {
  it("accepts a fresh signature bound to method, path, and body", async () => {
    await withServer(async (base) => {
      const body = JSON.stringify({ action: "rebalance", amountUsdc: 1 });
      const response = await fetch(`${base}/keeperhub/control?mode=force`, {
        method: "POST",
        headers: {
          ...signedHeaders("/keeperhub/control?mode=force", "POST", body),
          "Content-Type": "application/json",
        },
        body,
      });

      expect(response.status).toBe(204);
    });
  });

  it("rejects a captured request when replayed with the same nonce", async () => {
    await withServer(async (base) => {
      const path = "/keeperhub/control";
      const headers = signedHeaders(path);

      const first = await fetch(`${base}${path}`, { headers });
      const replay = await fetch(`${base}${path}`, { headers });

      expect(first.status).toBe(204);
      expect(replay.status).toBe(401);
    });
  });

  it("rejects signatures outside the replay window", async () => {
    await withServer(async (base) => {
      const timestamp = Math.floor(Date.now() / 1000) - 301;
      const response = await fetch(`${base}/keeperhub/control`, {
        headers: signedHeaders("/keeperhub/control", "GET", "", timestamp),
      });

      expect(response.status).toBe(401);
    });
  });

  it("rejects method, path, and body changes", async () => {
    await withServer(async (base) => {
      const body = JSON.stringify({ action: "rebalance" });
      const headers = signedHeaders("/keeperhub/control", "POST", body);

      const methodChanged = await fetch(`${base}/keeperhub/control`, {
        method: "PUT",
        headers,
        body,
      });
      const pathChanged = await fetch(`${base}/keeperhub/other`, { headers });
      const bodyChanged = await fetch(`${base}/keeperhub/control`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume" }),
      });

      expect(methodChanged.status).toBe(401);
      expect(pathChanged.status).toBe(401);
      expect(bodyChanged.status).toBe(401);
    });
  });

  it("rejects the legacy secret-only header", async () => {
    await withServer(async (base) => {
      const response = await fetch(`${base}/keeperhub/control`, {
        headers: { "X-ChronicleAI-Signature": SECRET },
      });

      expect(response.status).toBe(401);
    });
  });
});
