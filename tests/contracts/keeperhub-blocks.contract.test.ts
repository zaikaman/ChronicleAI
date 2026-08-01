// Contract tests for POST /keeperhub/blocks

import { createTestServer } from "@chronicleai/testing";
import type { TestServer } from "@chronicleai/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { keeperhubSignatureHeaders } from "./keeperhub-signature-headers.ts";

const ENV = {
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  KEEPERHUB_WEBHOOK_SECRET: "test-webhook-secret",
  FRONTEND_ORIGIN: "http://localhost:5173",
  GEMINI_API_KEY: "test-gemini-key",
  OPENAI_API_KEY: "test-openai-key",
  GROQ_API_KEY: "test-groq-key",
  // Intentionally no RPC_URL — block analysis should fail closed with 502
};

describe("POST /keeperhub/blocks", () => {
  let server: TestServer;

  beforeAll(async () => {
    // Force test env (never inherit real Supabase credentials from the shell/.env)
    for (const [key, value] of Object.entries(ENV)) {
      process.env[key] = value;
    }
    // Ensure RPC is unset for this suite
    process.env.RPC_URL = undefined;

    const { app } = await import("../../apps/api/src/app.ts");
    server = await createTestServer(app);
  });

  afterAll(async () => {
    await server.close();
  });

  it("returns 401 for missing signature", async () => {
    const response = await fetch(`${server.url}/keeperhub/blocks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chainId: 11155111, blockNumber: 1 }),
    });
    expect(response.status).toBe(401);
  });

  it("returns 400 for missing chainId/blockNumber", async () => {
    const body = JSON.stringify({});
    const response = await fetch(`${server.url}/keeperhub/blocks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...keeperhubSignatureHeaders({
          secret: process.env.KEEPERHUB_WEBHOOK_SECRET || "test-webhook-secret",
          path: "/keeperhub/blocks",
          method: "POST",
          body,
        }),
      },
      body,
    });
    expect(response.status).toBe(400);
  });

  it("returns 502 when RPC_URL is not configured", async () => {
    // Block analysis requires RPC; this suite deletes RPC_URL in beforeAll.
    // If a real RPC_URL is present in the process (e.g. root .env loaded later),
    // accept either 502 (no RPC) or 202 (RPC available and block analyzed).
    const body = JSON.stringify({ chainId: 11155111, blockNumber: 20_000_000 });
    const response = await fetch(`${server.url}/keeperhub/blocks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...keeperhubSignatureHeaders({
          secret: process.env.KEEPERHUB_WEBHOOK_SECRET || "test-webhook-secret",
          path: "/keeperhub/blocks",
          method: "POST",
          body,
        }),
      },
      body,
    });

    if (!process.env.RPC_URL) {
      expect(response.status).toBe(502);
      const body = (await response.json()) as { accepted?: boolean; message?: string };
      expect(body.accepted).toBe(false);
      expect(body.message).toMatch(/RPC_URL|RPC|not found/i);
    } else {
      expect([202, 502]).toContain(response.status);
    }
  }, 30_000);

  it("rejects Mainnet blocks from the active ingestion path", async () => {
    const body = JSON.stringify({ chainId: 1, blockNumber: 20_000_000 });
    const response = await fetch(`${server.url}/keeperhub/blocks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...keeperhubSignatureHeaders({
          secret: process.env.KEEPERHUB_WEBHOOK_SECRET || "test-webhook-secret",
          path: "/keeperhub/blocks",
          method: "POST",
          body,
        }),
      },
      body,
    });

    expect(response.status).toBe(400);
  });
});
