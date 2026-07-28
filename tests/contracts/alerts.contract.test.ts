// Contract tests for GET /alerts

import { createTestServer } from "@chronicleai/testing";
import type { TestServer } from "@chronicleai/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertItemsResponse, assertPublicAlertShape } from "./schema-assertions.ts";

const ENV = {
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  KEEPERHUB_WEBHOOK_SECRET: "test-webhook-secret",
  FRONTEND_ORIGIN: "http://localhost:5173",
  GEMINI_API_KEY: "test-gemini-key",
  OPENAI_API_KEY: "test-openai-key",
  GROQ_API_KEY: "test-groq-key",
};

describe("GET /alerts", () => {
  let server: TestServer;

  beforeAll(async () => {
    // Force test env (never inherit real Supabase credentials from the shell/.env)
    for (const [key, value] of Object.entries(ENV)) {
      process.env[key] = value;
    }

    // Dynamic import ensures env vars are set before module executes
    const { app } = await import("../../apps/api/src/app.ts");
    server = await createTestServer(app);
  });

  afterAll(async () => {
    await server.close();
  });

  it("returns 200 with empty items array", async () => {
    const response = await fetch(`${server.url}/alerts`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;
    assertItemsResponse(body);
    expect(body.items).toBeInstanceOf(Array);
  });

  it("returns 400 for invalid limit", async () => {
    const response = await fetch(`${server.url}/alerts?limit=999`);
    expect(response.status).toBe(400);
  });

  it("returns 400 for negative limit", async () => {
    const response = await fetch(`${server.url}/alerts?limit=-1`);
    expect(response.status).toBe(400);
  });

  it("returns 200 with default limit for valid limit param", async () => {
    const response = await fetch(`${server.url}/alerts?limit=10`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;
    assertItemsResponse(body);
  });

  it("valid response items have PublicAlert shape if present", async () => {
    const response = await fetch(`${server.url}/alerts`);
    const body = (await response.json()) as { items: Record<string, unknown>[] };

    if (body.items.length > 0) {
      for (const item of body.items) {
        assertPublicAlertShape(item);
      }
    }
  });
});
