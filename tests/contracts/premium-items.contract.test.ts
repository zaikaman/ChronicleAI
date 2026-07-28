// Contract tests for GET /premium/items
// Validates teaser list response shape
// Hits a live API process — skipped unless ALLOW_LIVE_API_TESTS=1

import { describe, expect, it } from "vitest";
import { LIVE_API_BASE, LIVE_API_TESTS_ENABLED } from "./live-api.ts";
import { assertPremiumItemTeaserShape } from "./schema-assertions.ts";

const API_BASE = LIVE_API_BASE;

describe.skipIf(!LIVE_API_TESTS_ENABLED)("GET /premium/items", () => {
  it("should return 200 with items array", async () => {
    const response = await fetch(`${API_BASE}/premium/items`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty("items");
    expect(Array.isArray(body.items)).toBe(true);
  });

  it("should return teaser-only fields (no private content)", async () => {
    const response = await fetch(`${API_BASE}/premium/items`);
    expect(response.status).toBe(200);

    const body = await response.json();

    for (const item of body.items) {
      // Should be a valid teaser shape
      expect(() => assertPremiumItemTeaserShape(item)).not.toThrow();

      // Must NOT contain private content
      expect(item).not.toHaveProperty("contentPrivate");
      expect(item).not.toHaveProperty("content_private");
      expect(item).not.toHaveProperty("sourceEventIds");
      expect(item).not.toHaveProperty("source_event_ids");
    }
  });

  it("should include price, currency, and payment routes for each item", async () => {
    const response = await fetch(`${API_BASE}/premium/items`);
    expect(response.status).toBe(200);

    const body = await response.json();

    for (const item of body.items) {
      expect(item).toHaveProperty("priceAmount");
      expect(item).toHaveProperty("priceCurrency");
      expect(item).toHaveProperty("paymentRoutes");
      expect(Array.isArray(item.paymentRoutes)).toBe(true);
      expect(item.priceAmount).toBeGreaterThan(0);
    }
  });

  it("should only return available items", async () => {
    const response = await fetch(`${API_BASE}/premium/items`);
    expect(response.status).toBe(200);

    const body = await response.json();

    for (const item of body.items) {
      expect(item.status).toBe("available");
    }
  });
});
