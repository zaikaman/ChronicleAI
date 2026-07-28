// Contract tests: POST /keeperhub/revenue/route
// Tests valid, invalid, and unsigned revenue routing requests
// Hits a live API process and can write payouts —
// skipped unless ALLOW_LIVE_API_TESTS=1

import { describe, expect, it } from "vitest";
import {
  LIVE_API_BASE,
  LIVE_API_TESTS_ENABLED,
  LIVE_KEEPERHUB_SIGNATURE,
} from "./live-api.ts";
import { assertHasRequiredFields } from "./schema-assertions.ts";

const API_URL = LIVE_API_BASE;
const VALID_SIGNATURE = LIVE_KEEPERHUB_SIGNATURE;

describe.skipIf(!LIVE_API_TESTS_ENABLED)("Contract: POST /keeperhub/revenue/route", () => {
  it("should authenticate and accept or reject a well-formed revenue routing payload", async () => {
    expect(VALID_SIGNATURE.length, "KEEPERHUB_WEBHOOK_SECRET must be set for live signed routes").toBeGreaterThan(0);

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

    // Auth must succeed; business outcome depends on treasury / schedule / balances.
    expect(response.status).not.toBe(401);
    expect([200, 201, 202, 400, 409, 503]).toContain(response.status);

    const body = (await response.json()) as Record<string, unknown>;
    if (response.status === 201 || response.status === 200) {
      assertHasRequiredFields(body, ["accepted", "message", "payoutCount"]);
      expect(body.accepted).toBe(true);
      expect(typeof body.message).toBe("string");
    } else {
      expect(body).toHaveProperty("error");
    }
  });

  it("should return 400 with invalid payload (missing periodHash)", async () => {
    expect(VALID_SIGNATURE.length).toBeGreaterThan(0);

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
    expect(VALID_SIGNATURE.length).toBeGreaterThan(0);

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
