// Unit tests for MPP payment adapter

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MppPaymentAdapter } from "../payments/mpp-payment-adapter.ts";

describe("MppPaymentAdapter", () => {
  const adapter = new MppPaymentAdapter({ mppSecret: "test-secret-key" });
  const testModeAdapter = new MppPaymentAdapter({
    mppSecret: "test-secret-key",
    allowTestMode: true,
  });
  const prodNoSecret = new MppPaymentAdapter();

  describe("createChallenge", () => {
    it("should create a challenge with expected shape", async () => {
      const result = await adapter.createChallenge({
        premiumItemId: "premium-001",
        amount: 5,
        currency: "USDC",
      });

      expect(result.challengeReference).toMatch(/^mpp_/);
      expect(result.paymentRoute).toBe("mpp");
      expect(result.amountRequested).toBe(5);
      expect(result.currency).toBe("USDC");
      expect(result.expiresAt).toBeTruthy();
      expect(result.challengeData).toHaveProperty("challengeNonce");
      expect(result.challengeData).toHaveProperty("verificationType", "hmac_sha256");
      // Production mode must not leak the expected HMAC
      expect(result.challengeData).not.toHaveProperty("expectedHmac");
    });

    it("should include expectedHmac only when allowTestMode is true", async () => {
      const result = await testModeAdapter.createChallenge({
        premiumItemId: "premium-001",
        amount: 5,
        currency: "USDC",
      });

      expect(result.challengeData).toHaveProperty("expectedHmac");
    });

    it("should create a challenge with different nonces each time", async () => {
      const result1 = await adapter.createChallenge({
        premiumItemId: "premium-001",
        amount: 5,
        currency: "USDC",
      });
      const result2 = await adapter.createChallenge({
        premiumItemId: "premium-001",
        amount: 5,
        currency: "USDC",
      });

      expect(result1.challengeData.challengeNonce).not.toBe(result2.challengeData.challengeNonce);
    });

    it("should create a challenge with expiry within 5 minutes", async () => {
      const now = Date.now();
      const result = await adapter.createChallenge({
        premiumItemId: "premium-001",
        amount: 10,
        currency: "USDC",
      });

      const expiresMs = new Date(result.expiresAt).getTime();
      const diffMs = expiresMs - now;

      expect(diffMs).toBeGreaterThan(0);
      expect(diffMs).toBeLessThanOrEqual(300_000 + 1000); // 5 min + 1s tolerance
    });

    it("should throw when secret is not configured and test mode is off", async () => {
      await expect(
        prodNoSecret.createChallenge({
          premiumItemId: "premium-001",
          amount: 5,
          currency: "USDC",
        }),
      ).rejects.toThrow("MPP secret key is not configured");
    });
  });

  describe("verifySettlement", () => {
    it("should accept a non-matching long HMAC only when allowTestMode is true", async () => {
      const challenge = await testModeAdapter.createChallenge({
        premiumItemId: "premium-001",
        amount: 5,
        currency: "USDC",
      });

      const settlementRef = `${challenge.expiresAt}:a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2`;

      const result = await testModeAdapter.verifySettlement({
        challengeReference: challenge.challengeReference,
        settlementReference: settlementRef,
        amountRequested: 5,
        currency: "USDC",
        paymentRoute: "mpp",
      });

      expect(result.verified).toBe(true);
      expect(result.amountSettled).toBe(5);
    });

    it("should reject non-matching HMAC when allowTestMode is false", async () => {
      const challenge = await adapter.createChallenge({
        premiumItemId: "premium-001",
        amount: 5,
        currency: "USDC",
      });

      const settlementRef = `${challenge.expiresAt}:a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2`;

      const result = await adapter.verifySettlement({
        challengeReference: challenge.challengeReference,
        settlementReference: settlementRef,
        amountRequested: 5,
        currency: "USDC",
        paymentRoute: "mpp",
      });

      expect(result.verified).toBe(false);
      expect(result.errorMessage).toContain("HMAC signature verification failed");
    });

    it("should reject invalid payment route", async () => {
      const result = await adapter.verifySettlement({
        challengeReference: "mpp_test",
        settlementReference: "mpp_test:hmac_sig",
        amountRequested: 5,
        currency: "USDC",
        paymentRoute: "x402",
      });

      expect(result.verified).toBe(false);
      expect(result.errorMessage).toContain("Invalid payment route");
    });

    it("should reject missing HMAC signature", async () => {
      const result = await adapter.verifySettlement({
        challengeReference: "mpp_test",
        settlementReference: "no-colon-format",
        amountRequested: 5,
        currency: "USDC",
        paymentRoute: "mpp",
      });

      expect(result.verified).toBe(false);
      expect(result.errorMessage).toContain("HMAC signature");
    });

    it("should reject empty settlement reference", async () => {
      const result = await adapter.verifySettlement({
        challengeReference: "mpp_test",
        settlementReference: "",
        amountRequested: 5,
        currency: "USDC",
        paymentRoute: "mpp",
      });

      expect(result.verified).toBe(false);
    });

    it("should verify a real cryptographic HMAC signature", async () => {
      const secret = "my-real-secret";
      const customAdapter = new MppPaymentAdapter({ mppSecret: secret });
      const amount = 5;
      const currency = "USDC";

      const challenge = await customAdapter.createChallenge({
        premiumItemId: "premium-001",
        amount,
        currency,
      });

      const expiresAt = challenge.expiresAt;
      const hmacPayload = `${challenge.challengeReference}|${amount}|${currency}|${expiresAt}`;
      const expectedHmac = createHmac("sha256", secret).update(hmacPayload).digest("hex");
      const settlementRef = `${expiresAt}:${expectedHmac}`;

      const result = await customAdapter.verifySettlement({
        challengeReference: challenge.challengeReference,
        settlementReference: settlementRef,
        amountRequested: amount,
        currency,
        paymentRoute: "mpp",
      });

      expect(result.verified).toBe(true);
      expect(result.amountSettled).toBe(amount);
      expect(result.payerReference).toContain("mpp-client-");
    });
  });
});
