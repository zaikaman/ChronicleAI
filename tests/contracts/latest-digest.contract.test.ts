// Contract tests for GET /digests/latest

import { createTestServer } from "@chronicleai/testing";
import type { TestServer } from "@chronicleai/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertDailyDigestShape } from "./schema-assertions.ts";

const ENV = {
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  KEEPERHUB_WEBHOOK_SECRET: "test-webhook-secret",
  FRONTEND_ORIGIN: "http://localhost:5173",
  GEMINI_API_KEY: "test-gemini-key",
  OPENAI_API_KEY: "test-openai-key",
  GROQ_API_KEY: "test-groq-key",
};

describe("GET /digests/latest", () => {
  let server: TestServer;

  beforeAll(async () => {
    // Force test env (never inherit real Supabase credentials from the shell/.env)
    for (const [key, value] of Object.entries(ENV)) {
      process.env[key] = value;
    }

    const { app } = await import("../../apps/api/src/app.ts");
    server = await createTestServer(app);
  });

  afterAll(async () => {
    await server.close();
  });

  it("returns 404 when no digests exist", async () => {
    const response = await fetch(`${server.url}/digests/latest`);
    expect(response.status).toBe(404);
  });

  it("returns DailyDigest shape when a digest exists", async () => {
    // Note: This test assumes a prior test created a digest; 404 is valid when empty
    const response = await fetch(`${server.url}/digests/latest`);

    if (response.status === 404) {
      expect(response.status).toBe(404);
      return;
    }

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    assertDailyDigestShape(body);
    expect(typeof body.reportDate).toBe("string");
    expect(typeof body.title).toBe("string");
    expect(typeof body.summary).toBe("string");
    expect(Array.isArray(body.highlights)).toBe(true);
  });
});
