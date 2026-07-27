// Unit tests for x402 payment adapter

import { ethers } from "ethers";
import { describe, expect, it } from "vitest";
import { X402PaymentAdapter } from "../payments/x402-payment-adapter.ts";

describe("X402PaymentAdapter", () => {
  // Test adapter with allowTestMode enabled so plain-string settlement references work
  const adapter = new X402PaymentAdapter({ allowTestMode: true });
  // Production adapter (no test mode) - rejects non-EIP-712 settlements
  const prodAdapter = new X402PaymentAdapter();

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
    describe("with allowTestMode=true", () => {
      it("should accept a valid settlement reference in test mode", async () => {
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

      it("should reject short settlement reference in test mode", async () => {
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

    describe("with allowTestMode=false (production)", () => {
      it("should reject invalid payment route", async () => {
        const result = await prodAdapter.verifySettlement({
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
        const result = await prodAdapter.verifySettlement({
          challengeReference: "x402_test",
          settlementReference: "",
          amountRequested: 5,
          currency: "USDC",
          paymentRoute: "x402",
        });

        expect(result.verified).toBe(false);
        expect(result.errorMessage).toContain("Invalid settlement");
      });

      it("should reject plain-string settlement references (no EIP-712 JSON)", async () => {
        const result = await prodAdapter.verifySettlement({
          challengeReference: "x402_test_challenge",
          settlementReference: "0xvalid_settlement_tx_hash",
          amountRequested: 5,
          currency: "USDC",
          paymentRoute: "x402",
        });

        expect(result.verified).toBe(false);
        expect(result.errorMessage).toContain(
          "JSON serialized EIP-712 authorization payload",
        );
      });

      it("should accept a valid EIP-712 signature settlement payload", async () => {
        const wallet = ethers.Wallet.createRandom();
        const amount = 5;
        const currency = "USDC";

        const challenge = await prodAdapter.createChallenge({
          premiumItemId: "premium-001",
          amount,
          currency,
          payerReference: wallet.address,
        });

        interface EIP712Domain {
          name: string;
          version: string;
          chainId: number;
          verifyingContract: string;
        }
        interface TransferWithAuthorizationType {
          name: string;
          type: string;
        }
        interface TransferWithAuthorizationMessage {
          from: string;
          to: string;
          value: number;
          validAfter: number;
          validBefore: number;
          nonce: string;
        }

        const challengeData = challenge.challengeData as {
          domain: EIP712Domain;
          types: {
            TransferWithAuthorization: TransferWithAuthorizationType[];
          };
          message: TransferWithAuthorizationMessage;
        };
        const { domain, types, message } = challengeData;

        const toAddress = "0x1234567890123456789012345678901234567890";
        const messageToSign = {
          ...message,
          from: wallet.address,
          to: toAddress,
        };

        const signature = await wallet.signTypedData(
          domain,
          {
            TransferWithAuthorization: types.TransferWithAuthorization,
          },
          messageToSign,
        );

        const settlementPayload = {
          signature,
          from: wallet.address,
          to: toAddress,
          value: messageToSign.value,
          validAfter: messageToSign.validAfter,
          validBefore: messageToSign.validBefore,
          nonce: messageToSign.nonce,
        };

        const result = await prodAdapter.verifySettlement({
          challengeReference: challenge.challengeReference,
          settlementReference: JSON.stringify(settlementPayload),
          amountRequested: amount,
          currency,
          paymentRoute: "x402",
        });

        expect(result.verified).toBe(true);
        expect(result.amountSettled).toBe(amount);
        expect(result.payerReference?.toLowerCase()).toBe(wallet.address.toLowerCase());
      });
    });
  });
});
