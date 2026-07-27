// Contract tests: POST /keeperhub/revenue/route
// Tests valid, invalid, and unsigned revenue routing requests

import { describe, expect, it } from "vitest";
import { assertHasRequiredFields } from "./schema-assertions.ts";

const API_URL = process.env["TEST_API_URL"] ?? "http://localhost:4000";
const VALID_SIGNATURE = process.env["TEST_KEEPERHUB_SECRET"] ?? "test-secret-key-for-testing";

describe("Contract: POST /keeperhub/revenue/route", () => {
  it("should return 201 with valid revenue routing payload", async () => {
    const response = await fetch(`${API_URL}/keeperhub/revenue/route`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ChronicleAI-Signature": VALID_SIGNATURE,
      },
      body: JSON.stringify({
        periodHash: `test-period-${Date.now()}`,
        force: false,
      }),
    });

    expect(response.status).toBe(201);

    const body = (await response.json()) as Record<string, unknown>;
    assertHasRequiredFields(body, ["accepted", "message", "payoutCount"]);
    expect(body.accepted).toBe(true);
    expect(typeof body.message).toBe("string");
  });

  it("should return 400 with invalid payload (missing periodHash)", async () => {
    const response = await fetch(`${API_URL}/keeperhub/revenue/route`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ChronicleAI-Signature": VALID_SIGNATURE,
      },
      body: JSON.stringify({
        force: true,
        // Missing periodHash
      }),
    });

    expect(response.status).toBe(400);

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("error");
    expect(String(body.error)).toContain("Invalid revenue routing payload");
  });

  it("should return 400 with empty body", async () => {
    const response = await fetch(`${API_URL}/keeperhub/revenue/route`, {
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
    const response = await fetch(`${API_URL}/keeperhub/revenue/route`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        periodHash: `test-period-${Date.now()}`,
      }),
    });

    expect(response.status).toBe(401);
  });

  it("should return 401 with invalid signature", async () => {
    const response = await fetch(`${API_URL}/keeperhub/revenue/route`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ChronicleAI-Signature": "invalid-signature",
      },
      body: JSON.stringify({
        periodHash: `test-period-${Date.now()}`,
      }),
    });

    expect(response.status).toBe(401);
  });
});
