// Contract tests: POST /keeperhub/treasury/check
// Tests valid, invalid, and unsigned treasury check requests

import { describe, expect, it } from "vitest";
import { assertHasRequiredFields } from "./schema-assertions.ts";

const API_URL = process.env["TEST_API_URL"] ?? "http://localhost:4000";
const VALID_SIGNATURE = process.env["TEST_KEEPERHUB_SECRET"] ?? process.env["KEEPERHUB_WEBHOOK_SECRET"] ?? "test-secret-key-for-testing";

describe("Contract: POST /keeperhub/treasury/check", () => {
  it("should return 201 with valid treasury check payload", async () => {
    const response = await fetch(`${API_URL}/keeperhub/treasury/check`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ChronicleAI-Signature": VALID_SIGNATURE,
      },
      body: JSON.stringify({
        capturedAt: new Date().toISOString(),
        availableBalance: 50000,
        currency: "USDC",
        safetyBuffer: 10000,
      }),
    });

    expect(response.status).toBe(201);

    const body = (await response.json()) as Record<string, unknown>;
    assertHasRequiredFields(body, ["accepted", "message"]);
    expect(body.accepted).toBe(true);
    expect(typeof body.message).toBe("string");
    expect(body.message).toContain("Treasury snapshot recorded");
  });

  it("should return 400 with invalid payload (missing fields)", async () => {
    const response = await fetch(`${API_URL}/keeperhub/treasury/check`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ChronicleAI-Signature": VALID_SIGNATURE,
      },
      body: JSON.stringify({
        capturedAt: new Date().toISOString(),
        // Missing availableBalance, currency, safetyBuffer
      }),
    });

    expect(response.status).toBe(400);

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("error");
    expect(String(body.error)).toContain("Invalid treasury check payload");
  });

  it("should return 400 with empty body", async () => {
    const response = await fetch(`${API_URL}/keeperhub/treasury/check`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ChronicleAI-Signature": VALID_SIGNATURE,
      },
      body: "{}",
    });

    expect(response.status).toBe(400);

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("error");
  });

  it("should return 401 without signature header", async () => {
    const response = await fetch(`${API_URL}/keeperhub/treasury/check`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        capturedAt: new Date().toISOString(),
        availableBalance: 50000,
        currency: "USDC",
        safetyBuffer: 10000,
      }),
    });

    expect(response.status).toBe(401);
  });

  it("should return 401 with invalid signature", async () => {
    const response = await fetch(`${API_URL}/keeperhub/treasury/check`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ChronicleAI-Signature": "invalid-signature",
      },
      body: JSON.stringify({
        capturedAt: new Date().toISOString(),
        availableBalance: 50000,
        currency: "USDC",
        safetyBuffer: 10000,
      }),
    });

    expect(response.status).toBe(401);
  });
});
