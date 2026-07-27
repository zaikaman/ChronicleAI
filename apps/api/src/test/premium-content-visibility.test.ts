// Unit tests for premium content visibility
// Ensures premium-only content never leaks into public responses

import { describe, expect, it } from "vitest";
import { PremiumContentVisibilityService } from "../services/premium-content-visibility-service.ts";
import { MOCK_PREMIUM_DEEP_DIVE, MOCK_PREMIUM_HISTORICAL_FEED } from "./fixtures/payments.ts";

describe("PremiumContentVisibilityService", () => {
  const service = new PremiumContentVisibilityService();

  describe("toTeaser", () => {
    it("should strip private content from deep dive item", () => {
      const teaser = service.toTeaser(MOCK_PREMIUM_DEEP_DIVE);

      expect(teaser.id).toBe(MOCK_PREMIUM_DEEP_DIVE.id);
      expect(teaser.title).toBe(MOCK_PREMIUM_DEEP_DIVE.title);
      expect(teaser.summaryPublic).toBe(MOCK_PREMIUM_DEEP_DIVE.summary_public);
      expect(teaser.priceAmount).toBe(MOCK_PREMIUM_DEEP_DIVE.price_amount);

      // MUST NOT include private content
      expect(teaser).not.toHaveProperty("contentPrivate");
      expect(teaser).not.toHaveProperty("content_private");
      expect(teaser).not.toHaveProperty("sourceEventIds");
    });

    it("should not include private analysis sections", () => {
      const teaser = service.toTeaser(MOCK_PREMIUM_DEEP_DIVE);

      // Ensure the teaser string summary doesn't leak private content
      expect(teaser.summaryPublic).not.toContain("12 liquidation events");
      expect(teaser.summaryPublic).not.toContain("$47.2M");
    });

    it("should strip private content from historical feed item", () => {
      const teaser = service.toTeaser(MOCK_PREMIUM_HISTORICAL_FEED);

      expect(teaser.id).toBe(MOCK_PREMIUM_HISTORICAL_FEED.id);
      expect(teaser.title).toBe(MOCK_PREMIUM_HISTORICAL_FEED.title);

      // MUST NOT include feed entries
      expect(teaser).not.toHaveProperty("contentPrivate");
      expect(teaser).not.toHaveProperty("feedEntries");
    });

    it("should preserve payment routes in teaser", () => {
      const teaser = service.toTeaser(MOCK_PREMIUM_DEEP_DIVE);

      expect(teaser.paymentRoutes).toEqual(["x402", "mpp"]);
      expect(teaser.contentType).toBe("deep_dive");
    });
  });

  describe("toFullWithPrivateContent", () => {
    it("should include private content in full view", () => {
      const full = service.toFullWithPrivateContent(MOCK_PREMIUM_DEEP_DIVE);

      expect(full).toHaveProperty("contentPrivate");
      expect(full.contentPrivate).toBeTruthy();
      expect(full).toHaveProperty("sourceEventIds");
      expect(full.sourceEventIds).toHaveLength(3);
    });

    it("should include analysis sections in full view", () => {
      const full = service.toFullWithPrivateContent(MOCK_PREMIUM_DEEP_DIVE);

      const content = full.contentPrivate as Record<string, unknown>;
      expect(content).toHaveProperty("sections");
      expect(content).toHaveProperty("analysis");
    });
  });

  describe("toTeaserList", () => {
    it("should convert a list of items to teasers", () => {
      const teasers = service.toTeaserList([MOCK_PREMIUM_DEEP_DIVE, MOCK_PREMIUM_HISTORICAL_FEED]);

      expect(teasers).toHaveLength(2);
      for (const teaser of teasers) {
        expect(teaser).not.toHaveProperty("contentPrivate");
      }
    });

    it("should not leak private content in any teaser", () => {
      const teasers = service.toTeaserList([MOCK_PREMIUM_DEEP_DIVE, MOCK_PREMIUM_HISTORICAL_FEED]);

      for (const teaser of teasers) {
        const keys = Object.keys(teaser);
        const hasLeakedPrivate = keys.some(
          (k) => k.includes("Private") || k.includes("private") || k.includes("content_private"),
        );
        expect(hasLeakedPrivate).toBe(false);
      }
    });
  });
});
