// Contract tests for GET /premium/items/:id
// Validates payment gating, 402 challenges, and access control

import { describe, expect, it } from "vitest";

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:4000";
const KNOWN_PREMIUM_ITEM_ID = "premium-deep-dive-001";

describe("GET /premium/items/:id", () => {
  it("should return 404 for non-existent item", async () => {
    const response = await fetch(`${API_BASE}/premium/items/non-existent-id`);
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body).toHaveProperty("error");
  });

  it("should return 402 Payment Required without payer reference", async () => {
    const response = await fetch(`${API_BASE}/premium/items/${KNOWN_PREMIUM_ITEM_ID}`);
    expect(response.status).toBe(402);

    const body = await response.json();
    expect(body).toHaveProperty("error");
    expect(body).toHaveProperty("item");
    expect(body).toHaveProperty("paymentRoute");
    expect(body).toHaveProperty("premiumItemId");
  });

  it("should return 402 Payment Required for unknown payer", async () => {
    const response = await fetch(
      `${API_BASE}/premium/items/${KNOWN_PREMIUM_ITEM_ID}?payer=unknown-wallet`,
    );
    expect(response.status).toBe(402);

    const body = await response.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toContain("Payment");
  });

  it("should return teaser data in 402 response (not full content)", async () => {
    const response = await fetch(`${API_BASE}/premium/items/${KNOWN_PREMIUM_ITEM_ID}`);
    expect(response.status).toBe(402);

    const body = await response.json();
    // Should have item teaser but no private content
    expect(body.item).not.toHaveProperty("contentPrivate");
    expect(body.item).not.toHaveProperty("content_private");
    expect(body.item).toHaveProperty("summaryPublic");
  });

  it("should return 500 for server errors gracefully", async () => {
    // Test with malformed ID that might cause DB issues
    const response = await fetch(`${API_BASE}/premium/items/__invalid__`);
    // Either 404 or 500 is acceptable, but not crash
    expect([404, 500]).toContain(response.status);
  });
});
