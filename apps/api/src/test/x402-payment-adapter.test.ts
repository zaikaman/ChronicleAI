// Unit tests for x402 payment adapter

import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { X402PaymentAdapter } from "../payments/x402-payment-adapter.ts";

const TREASURY = "0x1234567890123456789012345678901234567890";

function randomWallet(): PrivateKeyAccount {
  return privateKeyToAccount(generatePrivateKey());
}

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
  value: string | number;
  validAfter: string | number;
  validBefore: string | number;
  nonce: string;
}

async function signTransferWithAuthorization(
  wallet: PrivateKeyAccount,
  domain: EIP712Domain,
  types: { TransferWithAuthorization: TransferWithAuthorizationType[] },
  message: TransferWithAuthorizationMessage,
): Promise<Hex> {
  return wallet.signTypedData({
    domain: {
      name: domain.name,
      version: domain.version,
      chainId: domain.chainId,
      verifyingContract: domain.verifyingContract as Address,
    },
    types: {
      TransferWithAuthorization: types.TransferWithAuthorization,
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: message.from as Address,
      to: message.to as Address,
      value: BigInt(message.value),
      validAfter: BigInt(message.validAfter),
      validBefore: BigInt(message.validBefore),
      nonce: message.nonce as Hex,
    },
  });
}

async function signAuthorization(
  adapter: X402PaymentAdapter,
  wallet: PrivateKeyAccount,
  amount: number,
) {
  const challenge = await adapter.createChallenge({
    premiumItemId: "premium-001",
    amount,
    currency: "USDC",
    payerReference: wallet.address,
  });

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

  const signature = await signTransferWithAuthorization(
    wallet,
    domain,
    types,
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
      // Payer is not a referral partner — referralAddress only from intent metadata.
      expect(result.challengeData.referralAddress).toBeNull();
      expect((result.challengeData.message as { to: string }).to).toBe(TREASURY);
      expect(result.challengeData.network).toBe("eip155:84532");
      expect(result.challengeData.asset).toBe("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
      expect(result.challengeData.domain).toMatchObject({
        name: "USDC",
        version: "2",
        chainId: 84_532,
        verifyingContract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      });
    });

    it("should embed recurring newsletter agreement metadata in challengeData", async () => {
      const result = await adapter.createChallenge({
        premiumItemId: "newsletter-item",
        amount: 2,
        currency: "USDC",
        payerReference: "0x1111111111111111111111111111111111111111",
        agreement: {
          type: "recurring_newsletter",
          billingPeriodDays: 30,
          subscriptionId: "sub-uuid",
          periodKind: "renewal",
          referralAddress: "0x2222222222222222222222222222222222222222",
        },
      });

      expect(result.challengeData.agreementType).toBe("recurring_newsletter");
      expect(result.challengeData.billingPeriodDays).toBe(30);
      expect(result.challengeData.periodKind).toBe("renewal");
      expect(result.challengeData.subscriptionId).toBe("sub-uuid");
      expect(result.challengeData.product).toBe("monthly_newsletter");
      expect(result.challengeData.referralAddress).toBe(
        "0x2222222222222222222222222222222222222222",
      );
    });

    it("should accept top-level referralAddress without treating payer as affiliate", async () => {
      const affiliate = "0x2222222222222222222222222222222222222222";
      const result = await adapter.createChallenge({
        premiumItemId: "premium-001",
        amount: 5,
        currency: "USDC",
        payerReference: "0x1111111111111111111111111111111111111111",
        referralAddress: affiliate,
      });

      expect(result.challengeData.referralAddress).toBe(affiliate.toLowerCase());
    });

    it("should use configured chainId and USDC address in EIP-712 domain", async () => {
      const baseMainnetUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
      const custom = new X402PaymentAdapter({
        allowTestMode: true,
        treasuryWalletAddress: TREASURY,
        chainId: 8453,
        usdcAddress: baseMainnetUsdc,
      });

      const result = await custom.createChallenge({
        premiumItemId: "premium-001",
        amount: 5,
        currency: "USDC",
      });

      expect(result.challengeData.network).toBe("eip155:8453");
      expect(result.challengeData.asset).toBe(baseMainnetUsdc);
      expect(result.challengeData.domain).toMatchObject({
        chainId: 8453,
        verifyingContract: baseMainnetUsdc,
      });
    });

    it("should reject invalid chainId or USDC address at construction", () => {
      expect(
        () =>
          new X402PaymentAdapter({
            treasuryWalletAddress: TREASURY,
            chainId: 0,
          }),
      ).toThrow(/Invalid x402 chainId/);
      expect(
        () =>
          new X402PaymentAdapter({
            treasuryWalletAddress: TREASURY,
            usdcAddress: "not-an-address",
          }),
      ).toThrow(/Invalid x402 USDC address/);
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
        const wallet = randomWallet();
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
        const wallet = randomWallet();
        const amount = 5;
        const wrongTo = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

        const challenge = await prodAdapter.createChallenge({
          premiumItemId: "premium-001",
          amount,
          currency: "USDC",
          payerReference: wallet.address,
        });

        const challengeData = challenge.challengeData as {
          domain: EIP712Domain;
          types: { TransferWithAuthorization: TransferWithAuthorizationType[] };
          message: TransferWithAuthorizationMessage;
        };

        const messageToSign = {
          ...challengeData.message,
          from: wallet.address,
          to: wrongTo,
        };

        const signature = await signTransferWithAuthorization(
          wallet,
          challengeData.domain,
          challengeData.types,
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
        const wallet = randomWallet();
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
        const wallet = randomWallet();
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
        const wallet = randomWallet();
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
          domain: EIP712Domain;
          types: { TransferWithAuthorization: TransferWithAuthorizationType[] };
          message: TransferWithAuthorizationMessage;
        };

        // Sign for less than requested
        const underpaidValue = Math.round(1 * 1_000_000);
        const messageToSign = {
          ...challengeData.message,
          from: wallet.address,
          to: TREASURY,
          value: underpaidValue,
        };

        const signature = await signTransferWithAuthorization(
          wallet,
          challengeData.domain,
          challengeData.types,
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

      it("should accept unbound challenge (zero from) when client overwrites from at sign time", async () => {
        // Audit #6: challenge may use zero-address from when payer is not pre-bound.
        // Client sets from to the signing wallet; server enforces signer === from + treasury to.
        const wallet = randomWallet();
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

        // No payerReference → challenge message.from is zero address
        const challenge = await railAdapter.createChallenge({
          premiumItemId: "premium-001",
          amount,
          currency: "USDC",
        });

        const challengeData = challenge.challengeData as {
          domain: EIP712Domain;
          types: { TransferWithAuthorization: TransferWithAuthorizationType[] };
          message: TransferWithAuthorizationMessage;
        };

        expect(challengeData.message.from).toBe(
          "0x0000000000000000000000000000000000000000",
        );
        expect(challengeData.message.to).toBe(TREASURY);

        // Client overwrites from at sign time (matches PaymentChallengePanel)
        const messageToSign = {
          ...challengeData.message,
          from: wallet.address,
        };

        const signature = await signTransferWithAuthorization(
          wallet,
          challengeData.domain,
          challengeData.types,
          messageToSign,
        );

        const result = await railAdapter.verifySettlement({
          challengeReference: challenge.challengeReference,
          settlementReference: JSON.stringify({
            signature,
            from: wallet.address,
            to: TREASURY,
            value: messageToSign.value,
            validAfter: messageToSign.validAfter,
            validBefore: messageToSign.validBefore,
            nonce: messageToSign.nonce,
          }),
          amountRequested: amount,
          currency: "USDC",
          paymentRoute: "x402",
        });

        expect(result.verified).toBe(true);
        expect(result.payerReference?.toLowerCase()).toBe(wallet.address.toLowerCase());
        expect(result.settlementReference).toBe(txHash);
        expect(verifyTransactionReceipt).toHaveBeenCalledWith(
          txHash,
          expect.objectContaining({
            to: TREASURY,
            from: wallet.address,
          }),
        );
      });

      it("should reject settlement when authorization from remains the zero address", async () => {
        const wallet = randomWallet();
        const amount = 5;
        const zero = "0x0000000000000000000000000000000000000000";

        const railAdapter = new X402PaymentAdapter({
          treasuryWalletAddress: TREASURY,
          settleAuthorization: vi.fn(),
          verifyTransactionReceipt: vi.fn(),
        });

        const challenge = await railAdapter.createChallenge({
          premiumItemId: "premium-001",
          amount,
          currency: "USDC",
        });

        const challengeData = challenge.challengeData as {
          domain: EIP712Domain;
          types: { TransferWithAuthorization: TransferWithAuthorizationType[] };
          message: TransferWithAuthorizationMessage;
        };

        // Sign with real wallet but claim from=zero (should fail closed before rail)
        const messageToSign = {
          ...challengeData.message,
          from: zero,
          to: TREASURY,
        };

        const signature = await signTransferWithAuthorization(
          wallet,
          challengeData.domain,
          challengeData.types,
          messageToSign,
        );

        const result = await railAdapter.verifySettlement({
          challengeReference: challenge.challengeReference,
          settlementReference: JSON.stringify({
            signature,
            from: zero,
            to: TREASURY,
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
        expect(result.errorMessage).toMatch(/zero address/i);
      });

      it("should reject when recovered signer does not match authorization from", async () => {
        const signer = randomWallet();
        const claimedFrom = "0xcccccccccccccccccccccccccccccccccccccccc";
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
        });

        const challengeData = challenge.challengeData as {
          domain: EIP712Domain;
          types: { TransferWithAuthorization: TransferWithAuthorizationType[] };
          message: TransferWithAuthorizationMessage;
        };

        // Sign typed data where from is claimedFrom, but with a different key
        const messageToSign = {
          ...challengeData.message,
          from: claimedFrom,
          to: TREASURY,
        };

        const signature = await signTransferWithAuthorization(
          signer,
          challengeData.domain,
          challengeData.types,
          messageToSign,
        );

        const result = await railAdapter.verifySettlement({
          challengeReference: challenge.challengeReference,
          settlementReference: JSON.stringify({
            signature,
            from: claimedFrom,
            to: TREASURY,
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
        expect(result.errorMessage).toMatch(/recovered address does not match from/i);
      });

      it("should send CDP Bearer JWT when settling via CDP facilitator", async () => {
        const { generateKeyPairSync } = await import("node:crypto");
        const { privateKey, publicKey } = generateKeyPairSync("ed25519");
        const privJwk = privateKey.export({ format: "jwk" }) as { d?: string };
        const pubJwk = publicKey.export({ format: "jwk" }) as { x?: string };
        const seed = Buffer.from(privJwk.d!, "base64url");
        const x = Buffer.from(pubJwk.x!, "base64url");
        const apiKeySecret = Buffer.concat([seed, x]).toString("base64");
        const apiKeyId = "11111111-1111-4111-8111-111111111111";

        const txHash =
          "0x3333333333333333333333333333333333333333333333333333333333333333";
        const wallet = randomWallet();
        const amount = 2;

        const settleResponseBody = JSON.stringify({ success: true, transaction: txHash });
        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => settleResponseBody,
          json: async () => JSON.parse(settleResponseBody),
        });
        vi.stubGlobal("fetch", fetchMock);

        try {
          const railAdapter = new X402PaymentAdapter({
            facilitatorUrl: "https://api.cdp.coinbase.com/platform/v2/x402",
            cdpApiKeyId: apiKeyId,
            cdpApiKeySecret: apiKeySecret,
            treasuryWalletAddress: TREASURY,
            verifyTransactionReceipt: async () => ({
              confirmed: true,
              from: wallet.address,
              to: TREASURY,
              value: BigInt(Math.round(amount * 1_000_000)),
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

          expect(result.verified).toBe(true);
          expect(fetchMock).toHaveBeenCalled();
          const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
          const headers = init.headers as Record<string, string>;
          expect(headers.Authorization).toMatch(/^Bearer eyJ/);
          const body = JSON.parse(String(init.body)) as {
            x402Version: number;
            paymentPayload: unknown;
            paymentRequirements: unknown;
          };
          expect(body.x402Version).toBe(2);
          expect(body.paymentPayload).toBeDefined();
          expect(body.paymentRequirements).toBeDefined();
        } finally {
          vi.unstubAllGlobals();
        }
      });
    });
  });
});
