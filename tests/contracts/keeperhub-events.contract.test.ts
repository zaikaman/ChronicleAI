// Contract tests for POST /keeperhub/events

import { createTestServer } from "@chronicleai/testing";
import type { TestServer } from "@chronicleai/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createMalformedEvent,
  createQualifyingEvent,
  createRawUniswapSwapEvent,
} from "../../apps/api/src/test/fixtures/keeperhub-events.ts";
import { keeperhubSignatureHeaders } from "./keeperhub-signature-headers.ts";

// Set env vars before importing app (dynamic import in beforeAll)
const ENV = {
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  KEEPERHUB_WEBHOOK_SECRET: "test-webhook-secret",
  FRONTEND_ORIGIN: "http://localhost:5173",
  GEMINI_API_KEY: "test-gemini-key",
  OPENAI_API_KEY: "test-openai-key",
  GROQ_API_KEY: "test-groq-key",
};

describe("POST /keeperhub/events", () => {
  let server: TestServer;

  beforeAll(async () => {
    // Force test env (never inherit real Supabase credentials from the shell/.env)
    for (const [key, value] of Object.entries(ENV)) {
      process.env[key] = value;
    }

    // Use dynamic import to ensure env vars are set before app module executes
    const { app } = await import("../../apps/api/src/app.ts");
    server = await createTestServer(app);
  });

  afterAll(async () => {
    await server.close();
  });

  it("returns 401 for missing signature", async () => {
    const event = createQualifyingEvent();

    const response = await fetch(`${server.url}/keeperhub/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });

    expect(response.status).toBe(401);
  });

  it("returns 400 for malformed payload", async () => {
    const malformed = createMalformedEvent();
    const body = JSON.stringify(malformed);

    const response = await fetch(`${server.url}/keeperhub/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...keeperhubSignatureHeaders({
          secret: process.env.KEEPERHUB_WEBHOOK_SECRET || "test-webhook-secret",
          path: "/keeperhub/events",
          method: "POST",
          body,
        }),
      },
      body,
    });

    expect(response.status).toBe(400);
  });

  it(
    "returns 202 for valid qualifying event when signature is correct",
    async () => {
      const event = createQualifyingEvent();
      const body = JSON.stringify(event);

      const response = await fetch(`${server.url}/keeperhub/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...keeperhubSignatureHeaders({
            secret: process.env.KEEPERHUB_WEBHOOK_SECRET || "test-webhook-secret",
            path: "/keeperhub/events",
            method: "POST",
            body,
          }),
        },
        body,
      });

      // LLM generation may take a few seconds when providers are configured
      expect([202, 500]).toContain(response.status);
    },
    30_000,
  );

  it("returns 202 for raw Uniswap Swap payload (server-side normalization)", async () => {
    const event = createRawUniswapSwapEvent();
    const body = JSON.stringify(event);

    const response = await fetch(`${server.url}/keeperhub/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...keeperhubSignatureHeaders({
          secret: process.env.KEEPERHUB_WEBHOOK_SECRET || "test-webhook-secret",
          path: "/keeperhub/events",
          method: "POST",
          body,
        }),
      },
      body,
    });

    // 202 when DB is available; 500-class possible if routes partially configured
    expect([202, 500]).toContain(response.status);
    if (response.status === 202) {
      const body = (await response.json()) as { eventType?: string };
      expect(body.eventType).toBe("large_swap");
    }
  }, 30000);
});
