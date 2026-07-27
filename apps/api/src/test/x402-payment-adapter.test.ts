// Unit tests for x402 payment adapter

import { ethers } from "ethers";
import { describe, expect, it, vi } from "vitest";
import { X402PaymentAdapter } from "../payments/x402-payment-adapter.ts";

const TREASURY = "0x1234567890123456789012345678901234567890";

async function signAuthorization(
  adapter: X402PaymentAdapter,
  wallet: ethers.HDNodeWallet | ethers.Wallet,
  amount: number,
) {
  const challenge = await adapter.createChallenge({
    premiumItemId: "premium-001",
    amount,
    currency: "USDC",
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

  const messageToSign = {
    ...message,
    from: wallet.address,
    to: TREASURY,
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
    to: TREASURY,
    value: messageToSign.value,
    validAfter: messageToSign.validAfter,
    validBefore: messageToSign.validBefore,
    nonce: messageToSign.nonce,
  };

  return { challenge, settlementPayload, wallet };
}

describe("X402PaymentAdapter", () => {
  // Test adapter with allowTestMode enabled so plain-string settlement references work
  const adapter = new X402PaymentAdapter({
    allowTestMode: true,
    treasuryWalletAddress: TREASURY,
  });
  // Production adapter (no test mode) - rejects non-EIP-712 settlements and requires a real rail
  const prodAdapter = new X402PaymentAdapter({
    treasuryWalletAddress: TREASURY,
  });

  describe("createChallenge", () => {
    it("should create a challenge with expected shape", async () => {
      const result = await adapter.createChallenge({
        premiumItemId: "premium-001",
        amount: 5,
        currency: "USDC",
        payerReference: "0x1111111111111111111111111111111111111111",
      });

      expect(result.challengeReference).toMatch(/^x402_/);
      expect(result.paymentRoute).toBe("x402");
      expect(result.amountRequested).toBe(5);
      expect(result.currency).toBe("USDC");
      expect(result.expiresAt).toBeTruthy();
      expect(result.challengeData).toHaveProperty("expectedAmount", 5);
      expect(result.challengeData).toHaveProperty(
        "referralAddress",
        "0x1111111111111111111111111111111111111111",
      );
      expect((result.challengeData.message as { to: string }).to).toBe(TREASURY);
      expect(result.challengeData.network).toBe("eip155:84532");
      expect(result.challengeData.asset).toBe("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
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
      expect((result.challengeData.message as { from: string }).from).toBe(
        "0x0000000000000000000000000000000000000000",
      );
    });

    it("should throw when treasury wallet is not configured", async () => {
      const noTreasury = new X402PaymentAdapter();
      await expect(
        noTreasury.createChallenge({
          premiumItemId: "premium-001",
          amount: 5,
          currency: "USDC",
        }),
      ).rejects.toThrow("Treasury wallet address is not configured");
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
        expect(result.errorMessage).toMatch(
          /JSON serialized EIP-712|transaction hash|settlement rail|RPC_URL/i,
        );
      });

      it("should reject a valid EIP-712 signature when no settlement rail is configured", async () => {
        const wallet = ethers.Wallet.createRandom();
        const amount = 5;
        const { challenge, settlementPayload } = await signAuthorization(
          prodAdapter,
          wallet,
          amount,
        );

        const result = await prodAdapter.verifySettlement({
          challengeReference: challenge.challengeReference,
          settlementReference: JSON.stringify(settlementPayload),
          amountRequested: amount,
          currency: "USDC",
          paymentRoute: "x402",
        });

        expect(result.verified).toBe(false);
        expect(result.errorMessage).toMatch(/settlement rail|facilitator|RPC_URL/i);
      });

      it("should reject authorization when to is not the treasury", async () => {
        const wallet = ethers.Wallet.createRandom();
        const amount = 5;
        const wrongTo = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

        const challenge = await prodAdapter.createChallenge({
          premiumItemId: "premium-001",
          amount,
          currency: "USDC",
          payerReference: wallet.address,
        });

        const challengeData = challenge.challengeData as {
          domain: ethers.TypedDataDomain;
          types: { TransferWithAuthorization: Array<{ name: string; type: string }> };
          message: {
            from: string;
            to: string;
            value: number;
            validAfter: number;
            validBefore: number;
            nonce: string;
          };
        };

        const messageToSign = {
          ...challengeData.message,
          from: wallet.address,
          to: wrongTo,
        };

        const signature = await wallet.signTypedData(
          challengeData.domain,
          { TransferWithAuthorization: challengeData.types.TransferWithAuthorization },
          messageToSign,
        );

        const result = await prodAdapter.verifySettlement({
          challengeReference: challenge.challengeReference,
          settlementReference: JSON.stringify({
            signature,
            from: wallet.address,
            to: wrongTo,
            value: messageToSign.value,
            validAfter: messageToSign.validAfter,
            validBefore: messageToSign.validBefore,
            nonce: messageToSign.nonce,
          }),
          amountRequested: amount,
          currency: "USDC",
          paymentRoute: "x402",
        });

        expect(result.verified).toBe(false);
        expect(result.errorMessage).toContain("does not match treasury");
      });

      it("should settle only after successful transfer rail + receipt matching treasury", async () => {
        const wallet = ethers.Wallet.createRandom();
        const amount = 5;
        const txHash =
          "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

        const settleAuthorization = vi.fn().mockResolvedValue({
          success: true,
          transactionHash: txHash,
        });
        const verifyTransactionReceipt = vi.fn().mockResolvedValue({
          confirmed: true,
          from: wallet.address,
          to: TREASURY,
          value: BigInt(Math.round(amount * 1_000_000)),
        });

        const railAdapter = new X402PaymentAdapter({
          treasuryWalletAddress: TREASURY,
          settleAuthorization,
          verifyTransactionReceipt,
        });

        const { challenge, settlementPayload } = await signAuthorization(
          railAdapter,
          wallet,
          amount,
        );

        const result = await railAdapter.verifySettlement({
          challengeReference: challenge.challengeReference,
          settlementReference: JSON.stringify(settlementPayload),
          amountRequested: amount,
          currency: "USDC",
          paymentRoute: "x402",
        });

        expect(result.verified).toBe(true);
        expect(result.amountSettled).toBe(amount);
        expect(result.payerReference?.toLowerCase()).toBe(wallet.address.toLowerCase());
        // Settlement reference becomes the on-chain tx hash, not the raw signature JSON
        expect(result.settlementReference).toBe(txHash);
        expect(settleAuthorization).toHaveBeenCalledOnce();
        expect(verifyTransactionReceipt).toHaveBeenCalledWith(
          txHash,
          expect.objectContaining({
            to: TREASURY,
            minValue: BigInt(Math.round(amount * 1_000_000)),
            from: wallet.address,
          }),
        );
      });

      it("should reject when transfer rail succeeds but receipt does not match treasury/amount", async () => {
        const wallet = ethers.Wallet.createRandom();
        const amount = 5;
        const txHash =
          "0x1111111111111111111111111111111111111111111111111111111111111111";

        const railAdapter = new X402PaymentAdapter({
          treasuryWalletAddress: TREASURY,
          settleAuthorization: async () => ({
            success: true,
            transactionHash: txHash,
          }),
          verifyTransactionReceipt: async () => ({
            confirmed: false,
            errorMessage: "No matching USDC Transfer event to treasury found in transaction receipt",
          }),
        });

        const { challenge, settlementPayload } = await signAuthorization(
          railAdapter,
          wallet,
          amount,
        );

        const result = await railAdapter.verifySettlement({
          challengeReference: challenge.challengeReference,
          settlementReference: JSON.stringify(settlementPayload),
          amountRequested: amount,
          currency: "USDC",
          paymentRoute: "x402",
        });

        expect(result.verified).toBe(false);
        expect(result.errorMessage).toMatch(/receipt|treasury/i);
        expect(result.settlementReference).toBe(txHash);
      });

      it("should verify an existing on-chain transaction hash via receipt check", async () => {
        const payer = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        const txHash =
          "0x2222222222222222222222222222222222222222222222222222222222222222";
        const amount = 3;

        const railAdapter = new X402PaymentAdapter({
          treasuryWalletAddress: TREASURY,
          verifyTransactionReceipt: async (hash, expected) => {
            expect(hash).toBe(txHash);
            expect(expected.to).toBe(TREASURY);
            expect(expected.minValue).toBe(BigInt(Math.round(amount * 1_000_000)));
            return {
              confirmed: true,
              from: payer,
              to: TREASURY,
              value: expected.minValue,
            };
          },
        });

        const result = await railAdapter.verifySettlement({
          challengeReference: "x402_unused_for_tx_path",
          settlementReference: txHash,
          amountRequested: amount,
          currency: "USDC",
          paymentRoute: "x402",
        });

        expect(result.verified).toBe(true);
        expect(result.settlementReference).toBe(txHash);
        expect(result.payerReference?.toLowerCase()).toBe(payer.toLowerCase());
      });

      it("should reject underpaid authorization before settlement rail", async () => {
        const wallet = ethers.Wallet.createRandom();
        const amount = 5;

        const railAdapter = new X402PaymentAdapter({
          treasuryWalletAddress: TREASURY,
          settleAuthorization: vi.fn(),
          verifyTransactionReceipt: vi.fn(),
        });

        const challenge = await railAdapter.createChallenge({
          premiumItemId: "premium-001",
          amount,
          currency: "USDC",
          payerReference: wallet.address,
        });

        const challengeData = challenge.challengeData as {
          domain: ethers.TypedDataDomain;
          types: { TransferWithAuthorization: Array<{ name: string; type: string }> };
          message: {
            from: string;
            to: string;
            value: number;
            validAfter: number;
            validBefore: number;
            nonce: string;
          };
        };

        // Sign for less than requested
        const underpaidValue = Math.round(1 * 1_000_000);
        const messageToSign = {
          ...challengeData.message,
          from: wallet.address,
          to: TREASURY,
          value: underpaidValue,
        };

        const signature = await wallet.signTypedData(
          challengeData.domain,
          { TransferWithAuthorization: challengeData.types.TransferWithAuthorization },
          messageToSign,
        );

        const result = await railAdapter.verifySettlement({
          challengeReference: challenge.challengeReference,
          settlementReference: JSON.stringify({
            signature,
            from: wallet.address,
            to: TREASURY,
            value: underpaidValue,
            validAfter: messageToSign.validAfter,
            validBefore: messageToSign.validBefore,
            nonce: messageToSign.nonce,
          }),
          amountRequested: amount,
          currency: "USDC",
          paymentRoute: "x402",
        });

        expect(result.verified).toBe(false);
        expect(result.errorMessage).toContain("Insufficient payment value");
        expect(railAdapter).toBeTruthy();
      });
    });
  });
});
