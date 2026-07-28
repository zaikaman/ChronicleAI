import { describe, expect, it } from "vitest";
import {
  buildReferralAttribution,
  buildSubscriptionAnalytics,
  normalizeToMonthlyMrr,
} from "../services/activity-analytics.ts";

describe("activity-analytics", () => {
  describe("normalizeToMonthlyMrr", () => {
    it("keeps monthly amounts as-is for 30-day periods", () => {
      expect(normalizeToMonthlyMrr(10, 30)).toBe(10);
    });

    it("scales weekly charges to monthly", () => {
      expect(normalizeToMonthlyMrr(7, 7)).toBeCloseTo(30, 5);
    });

    it("returns 0 for non-positive amounts", () => {
      expect(normalizeToMonthlyMrr(0, 30)).toBe(0);
      expect(normalizeToMonthlyMrr(-5, 30)).toBe(0);
    });
  });

  describe("buildSubscriptionAnalytics", () => {
    it("computes MRR, conversion, and route mix from real rows", () => {
      const analytics = buildSubscriptionAnalytics(
        [
          {
            status: "settled",
            payment_route: "x402",
            amount_settled: 5,
            amount_requested: 5,
            currency: "USDC",
            referral_address: "0xaff1",
          },
          {
            status: "settled",
            payment_route: "mpp",
            amount_settled: 1,
            amount_requested: 1,
            currency: "USDC",
            referral_address: null,
          },
          {
            status: "expired",
            payment_route: "x402",
            amount_settled: null,
            amount_requested: 5,
            currency: "USDC",
            referral_address: null,
          },
          {
            status: "pending",
            payment_route: "mpp",
            amount_settled: null,
            amount_requested: 1,
            currency: "USDC",
            referral_address: null,
          },
        ],
        [
          {
            status: "active",
            amount_per_period: 10,
            currency: "USDC",
            billing_period_days: 30,
            referral_address: "0xaff1",
          },
          {
            status: "cancelled",
            amount_per_period: 10,
            currency: "USDC",
            billing_period_days: 30,
            referral_address: null,
          },
        ],
      );

      expect(analytics.mrr).toBe(10);
      expect(analytics.activeNewsletterSubscriptions).toBe(1);
      expect(analytics.settledPayments).toBe(2);
      expect(analytics.totalPaymentAttempts).toBe(4);
      expect(analytics.conversionRate).toBe(0.5);
      expect(analytics.totalSettledVolume).toBe(6);
      expect(analytics.referredSettledCount).toBe(1);
      expect(analytics.referredSettledVolume).toBe(5);
      expect(analytics.routeMix).toEqual([
        { route: "x402", settledCount: 1, settledVolume: 5, volumeShare: 5 / 6 },
        { route: "mpp", settledCount: 1, settledVolume: 1, volumeShare: 1 / 6 },
      ]);
    });

    it("returns zero conversion when there are no payment attempts", () => {
      const analytics = buildSubscriptionAnalytics([], []);
      expect(analytics.conversionRate).toBe(0);
      expect(analytics.mrr).toBe(0);
      expect(analytics.routeMix).toEqual([]);
    });
  });

  describe("buildReferralAttribution", () => {
    it("aggregates partners from payments and newsletters with affiliate metadata", () => {
      const attribution = buildReferralAttribution(
        [
          {
            status: "settled",
            payment_route: "x402",
            amount_settled: 20,
            amount_requested: 20,
            currency: "USDC",
            referral_address: "0xAAA0000000000000000000000000000000000001",
          },
          {
            status: "settled",
            payment_route: "x402",
            amount_settled: 5,
            amount_requested: 5,
            currency: "USDC",
            referral_address: "0xaaa0000000000000000000000000000000000001",
          },
          {
            status: "failed",
            payment_route: "x402",
            amount_settled: null,
            amount_requested: 5,
            currency: "USDC",
            referral_address: "0xaaa0000000000000000000000000000000000001",
          },
        ],
        [
          {
            status: "active",
            amount_per_period: 10,
            currency: "USDC",
            billing_period_days: 30,
            referral_address: "0xaaa0000000000000000000000000000000000001",
          },
          {
            status: "active",
            amount_per_period: 10,
            currency: "USDC",
            billing_period_days: 30,
            referral_address: "0xbbb0000000000000000000000000000000000002",
          },
        ],
        [
          {
            wallet_address: "0xaaa0000000000000000000000000000000000001",
            display_name: "Alpha Partner",
            referral_code: "alpha",
            status: "approved",
          },
        ],
      );

      expect(attribution.totalReferredPayments).toBe(2);
      expect(attribution.totalReferredVolume).toBe(25);
      expect(attribution.partners).toHaveLength(2);

      const alpha = attribution.partners.find((p) => p.referralCode === "alpha");
      expect(alpha).toMatchObject({
        displayName: "Alpha Partner",
        settledPaymentCount: 2,
        attributedVolume: 25,
        newsletterSubscriptionCount: 1,
        affiliateStatus: "approved",
      });

      const beta = attribution.partners.find(
        (p) => p.referralAddress === "0xbbb0000000000000000000000000000000000002",
      );
      expect(beta).toMatchObject({
        displayName: null,
        settledPaymentCount: 0,
        attributedVolume: 0,
        newsletterSubscriptionCount: 1,
        affiliateStatus: null,
      });
    });
  });
});
