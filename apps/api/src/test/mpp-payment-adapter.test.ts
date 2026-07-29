// Unit tests for MPP payment adapter

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MppPaymentAdapter,
  resolveMppPayerReference,
} from "../payments/mpp-payment-adapter.ts";

describe("MppPaymentAdapter", () => {
  const adapter = new MppPaymentAdapter({ mppSecret: "test-secret-key" });
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

    it("should include normalized EVM payerReference in challengeData when provided", async () => {
      const payer = "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01";
      const result = await adapter.createChallenge({
        premiumItemId: "premium-001",
        amount: 5,
        currency: "USDC",
        payerReference: payer,
      });

      expect(result.challengeData.payerReference).toBe(payer.toLowerCase());
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
    it("should reject non-matching HMAC", async () => {
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

    it("should reject settlements where embedded expiresAt is in the past", async () => {
      const secret = "my-real-secret";
      const customAdapter = new MppPaymentAdapter({ mppSecret: secret });
      const amount = 5;
      const currency = "USDC";
      const challengeRef = "mpp_expired_challenge_ref";
      const pastExpiresAt = new Date(Date.now() - 60_000).toISOString();
      const hmacPayload = `${challengeRef}|${amount}|${currency}|${pastExpiresAt}`;
      const expectedHmac = createHmac("sha256", secret).update(hmacPayload).digest("hex");
      const settlementRef = `${pastExpiresAt}:${expectedHmac}`;

      const result = await customAdapter.verifySettlement({
        challengeReference: challengeRef,
        settlementReference: settlementRef,
        amountRequested: amount,
        currency,
        paymentRoute: "mpp",
      });

      expect(result.verified).toBe(false);
      expect(result.errorMessage).toMatch(/expired/i);
    });

    it("should reject settlement expiresAt that does not match challenge expires_at", async () => {
      const secret = "my-real-secret";
      const customAdapter = new MppPaymentAdapter({ mppSecret: secret });
      const amount = 5;
      const currency = "USDC";

      const challenge = await customAdapter.createChallenge({
        premiumItemId: "premium-001",
        amount,
        currency,
      });

      // Valid HMAC for a *different* future expiry than the challenge
      const otherExpires = new Date(Date.now() + 120_000).toISOString();
      const hmacPayload = `${challenge.challengeReference}|${amount}|${currency}|${otherExpires}`;
      const expectedHmac = createHmac("sha256", secret).update(hmacPayload).digest("hex");
      const settlementRef = `${otherExpires}:${expectedHmac}`;

      const result = await customAdapter.verifySettlement({
        challengeReference: challenge.challengeReference,
        settlementReference: settlementRef,
        amountRequested: amount,
        currency,
        paymentRoute: "mpp",
        challengeExpiresAt: challenge.expiresAt,
      });

      expect(result.verified).toBe(false);
      expect(result.errorMessage).toMatch(/does not match challenge/i);
    });

    it("should reject invalid expiresAt timestamp in settlement reference", async () => {
      const result = await adapter.verifySettlement({
        challengeReference: "mpp_test",
        settlementReference: "not-a-date:a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
        amountRequested: 5,
        currency: "USDC",
        paymentRoute: "mpp",
      });

      expect(result.verified).toBe(false);
      expect(result.errorMessage).toMatch(/expiresAt/i);
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
      expect(result.payerReference).toBeUndefined();
    });

    it("should map challenge-time EVM payerReference for access scoping (not affiliate payouts)", async () => {
      const secret = "my-real-secret";
      const customAdapter = new MppPaymentAdapter({ mppSecret: secret });
      const amount = 5;
      const currency = "USDC";
      const payer = "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01";

      const challenge = await customAdapter.createChallenge({
        premiumItemId: "premium-001",
        amount,
        currency,
        payerReference: payer,
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
        challengePayerReference: payer,
      });

      expect(result.verified).toBe(true);
      expect(result.payerReference).toBe(payer.toLowerCase());
    });
  });

  describe("resolveMppPayerReference", () => {
    it("normalizes EVM addresses", () => {
      expect(resolveMppPayerReference("0xAbCdEf0123456789AbCdEf0123456789AbCdEf01")).toBe(
        "0xabcdef0123456789abcdef0123456789abcdef01",
      );
    });

    it("drops synthetic mpp-client ids", () => {
      expect(resolveMppPayerReference("mpp-client-2026-07-")).toBeUndefined();
    });

    it("returns undefined for empty values", () => {
      expect(resolveMppPayerReference(null)).toBeUndefined();
      expect(resolveMppPayerReference(undefined)).toBeUndefined();
      expect(resolveMppPayerReference("")).toBeUndefined();
    });
  });
});
