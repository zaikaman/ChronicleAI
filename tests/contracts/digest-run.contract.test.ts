// Contract tests for POST /keeperhub/digests/run

import { createTestServer } from "@chronicleai/testing";
import type { TestServer } from "@chronicleai/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createInvalidWindowPayload,
  createValidDigestRunPayload,
} from "../../apps/api/src/test/fixtures/digests.ts";

const ENV = {
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  KEEPERHUB_WEBHOOK_SECRET: "test-webhook-secret",
  FRONTEND_ORIGIN: "http://localhost:5173",
  GEMINI_API_KEY: "test-gemini-key",
  OPENAI_API_KEY: "test-openai-key",
  GROQ_API_KEY: "test-groq-key",
  // Contract suite only asserts HTTP auth/validation — skip boot-time digest generation
  DIGEST_SCHEDULE_ENABLED: "false",
};

describe("POST /keeperhub/digests/run", () => {
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

  it("returns 401 for missing signature", async () => {
    const payload = createValidDigestRunPayload();

    const response = await fetch(`${server.url}/keeperhub/digests/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(401);
  });

  it("returns 400 for invalid payload (missing periodEnd)", async () => {
    const invalid = createInvalidWindowPayload();

    const response = await fetch(`${server.url}/keeperhub/digests/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ChronicleAI-Signature": process.env.KEEPERHUB_WEBHOOK_SECRET || "test-webhook-secret",
      },
      body: JSON.stringify(invalid),
    });

    expect(response.status).toBe(400);
  });

  it("returns 400 for reversed window (start after end)", async () => {
    const now = Date.now();

    const response = await fetch(`${server.url}/keeperhub/digests/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ChronicleAI-Signature": process.env.KEEPERHUB_WEBHOOK_SECRET || "test-webhook-secret",
      },
      body: JSON.stringify({
        periodStart: new Date(now).toISOString(),
        periodEnd: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
      }),
    });

    expect(response.status).toBe(400);
  });
});
