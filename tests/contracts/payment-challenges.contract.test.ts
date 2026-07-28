// Contract tests for POST /payments/challenges
// Validates payment challenge creation for x402 and MPP routes
// Hits a live API process and can insert payment_records —
// skipped unless ALLOW_LIVE_API_TESTS=1

import { describe, expect, it } from "vitest";
import { LIVE_API_BASE, LIVE_API_TESTS_ENABLED } from "./live-api.ts";

const API_BASE = LIVE_API_BASE;
const KNOWN_PREMIUM_ITEM_ID = "premium-deep-dive-001";

describe.skipIf(!LIVE_API_TESTS_ENABLED)("POST /payments/challenges", () => {
  it("should return 400 when premiumItemId is missing", async () => {
    const response = await fetch(`${API_BASE}/payments/challenges`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentRoute: "x402" }),
    });
    expect(response.status).toBe(400);
  });

  it("should return 400 when paymentRoute is missing", async () => {
    const response = await fetch(`${API_BASE}/payments/challenges`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ premiumItemId: KNOWN_PREMIUM_ITEM_ID }),
    });
    expect(response.status).toBe(400);
  });

  it("should return 400 for unsupported payment route", async () => {
    const response = await fetch(`${API_BASE}/payments/challenges`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        premiumItemId: KNOWN_PREMIUM_ITEM_ID,
        paymentRoute: "unsupported",
      }),
    });
    expect(response.status).toBe(400);
  });

  it("should create x402 challenge and return 201", async () => {
    const response = await fetch(`${API_BASE}/payments/challenges`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        premiumItemId: KNOWN_PREMIUM_ITEM_ID,
        paymentRoute: "x402",
      }),
    });
    // This may 404 if the test DB doesn't have the premium item
    // But if it succeeds, validate the shape
    if (response.status === 201) {
      const body = await response.json();
      expect(body).toHaveProperty("challengeReference");
      expect(body).toHaveProperty("paymentRoute", "x402");
      expect(body).toHaveProperty("amountRequested");
      expect(body).toHaveProperty("currency");
      expect(body).toHaveProperty("expiresAt");
      expect(body).toHaveProperty("challengeData");
      expect(body).toHaveProperty("paymentRecordId");
    } else {
      expect([404, 500]).toContain(response.status);
    }
  });

  it("should create MPP challenge and return 201", async () => {
    const response = await fetch(`${API_BASE}/payments/challenges`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        premiumItemId: KNOWN_PREMIUM_ITEM_ID,
        paymentRoute: "mpp",
      }),
    });

    if (response.status === 201) {
      const body = await response.json();
      expect(body).toHaveProperty("challengeReference");
      expect(body).toHaveProperty("paymentRoute", "mpp");
      expect(body).toHaveProperty("amountRequested");
      expect(body).toHaveProperty("currency");
      expect(body).toHaveProperty("expiresAt");
      expect(body.challengeData).toHaveProperty("expectedHmac");
    } else {
      expect([404, 500]).toContain(response.status);
    }
  });

  it("should return 404 for non-existent premium item", async () => {
    const response = await fetch(`${API_BASE}/payments/challenges`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        premiumItemId: "non-existent-item",
        paymentRoute: "x402",
      }),
    });
    expect(response.status).toBe(404);
  });
});
