// Contract tests for POST /payments/settlements
// Validates settlement processing for various paths
// Hits a live API process — skipped unless ALLOW_LIVE_API_TESTS=1

import { describe, expect, it } from "vitest";
import { LIVE_API_BASE, LIVE_API_TESTS_ENABLED } from "./live-api.ts";

const API_BASE = LIVE_API_BASE;

describe.skipIf(!LIVE_API_TESTS_ENABLED)("POST /payments/settlements", () => {
  it("should return 400 when challengeReference is missing", async () => {
    const response = await fetch(`${API_BASE}/payments/settlements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settlementReference: "0xtest",
        paymentRoute: "x402",
      }),
    });
    expect(response.status).toBe(400);
  });

  it("should return 400 when settlementReference is missing", async () => {
    const response = await fetch(`${API_BASE}/payments/settlements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challengeReference: "test-challenge",
        paymentRoute: "x402",
      }),
    });
    expect(response.status).toBe(400);
  });

  it("should return 400 when paymentRoute is missing", async () => {
    const response = await fetch(`${API_BASE}/payments/settlements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challengeReference: "test-challenge",
        settlementReference: "0xtest",
      }),
    });
    expect(response.status).toBe(400);
  });

  it("should return 400 for expired challenge settlement", async () => {
    // Try to settle an expired challenge
    const response = await fetch(`${API_BASE}/payments/settlements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challengeReference: "expired_challenge_ref",
        settlementReference: "0xsettlement",
        paymentRoute: "x402",
      }),
    });
    // Should fail - challenge doesn't exist or is expired
    expect(response.status).toBe(400);
  });

  it("should return 400 for malformed settlement references", async () => {
    const response = await fetch(`${API_BASE}/payments/settlements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challengeReference: "non-existent-challenge",
        settlementReference: "", // empty
        paymentRoute: "x402",
      }),
    });
    expect(response.status).toBe(400);
  });
});
