// Unit tests for x402 payment adapter

import { describe, expect, it } from "vitest";
import { X402PaymentAdapter } from "../payments/x402-payment-adapter.ts";

describe("X402PaymentAdapter", () => {
  const adapter = new X402PaymentAdapter();

  describe("createChallenge", () => {
    it("should create a challenge with expected shape", async () => {
      const result = await adapter.createChallenge({
        premiumItemId: "premium-001",
        amount: 5,
        currency: "USDC",
        payerReference: "0xpayer",
      });

      expect(result.challengeReference).toMatch(/^x402_/);
      expect(result.paymentRoute).toBe("x402");
      expect(result.amountRequested).toBe(5);
      expect(result.currency).toBe("USDC");
      expect(result.expiresAt).toBeTruthy();
      expect(result.challengeData).toHaveProperty("expectedAmount", 5);
      expect(result.challengeData).toHaveProperty("referralAddress", "0xpayer");
    });

    it("should create a challenge with default expiry within 10 minutes", async () => {
      const now = Date.now();
      const result = await adapter.createChallenge({
        premiumItemId: "premium-001",
        amount: 10,
        currency: "USDC",
      });

      const expiresMs = new Date(result.expiresAt).getTime();
      const diffMs = expiresMs - now;

      expect(diffMs).toBeGreaterThan(0);
      expect(diffMs).toBeLessThanOrEqual(600_000 + 1000); // 10 min + 1s tolerance
    });

    it("should handle missing payerReference gracefully", async () => {
      const result = await adapter.createChallenge({
        premiumItemId: "premium-001",
        amount: 5,
        currency: "USDC",
      });

      expect(result.challengeData.referralAddress).toBeNull();
    });
  });

  describe("verifySettlement", () => {
    it("should verify a valid settlement", async () => {
      const result = await adapter.verifySettlement({
        challengeReference: "x402_test_challenge",
        settlementReference: "0xvalid_settlement_tx_hash",
        amountRequested: 5,
        currency: "USDC",
        paymentRoute: "x402",
      });

      expect(result.verified).toBe(true);
      expect(result.amountSettled).toBe(5);
      expect(result.currency).toBe("USDC");
      expect(result.settlementReference).toBe("0xvalid_settlement_tx_hash");
      expect(result.payerReference).toBeTruthy();
    });

    it("should reject invalid payment route", async () => {
      const result = await adapter.verifySettlement({
        challengeReference: "x402_test",
        settlementReference: "0xsomething",
        amountRequested: 5,
        currency: "USDC",
        paymentRoute: "mpp",
      });

      expect(result.verified).toBe(false);
      expect(result.errorMessage).toContain("Invalid payment route");
    });

    it("should reject empty settlement reference", async () => {
      const result = await adapter.verifySettlement({
        challengeReference: "x402_test",
        settlementReference: "",
        amountRequested: 5,
        currency: "USDC",
        paymentRoute: "x402",
      });

      expect(result.verified).toBe(false);
      expect(result.errorMessage).toContain("Invalid settlement");
    });

    it("should reject short settlement reference", async () => {
      const result = await adapter.verifySettlement({
        challengeReference: "x402_test",
        settlementReference: "abc",
        amountRequested: 5,
        currency: "USDC",
        paymentRoute: "x402",
      });

      expect(result.verified).toBe(false);
    });
  });
});
