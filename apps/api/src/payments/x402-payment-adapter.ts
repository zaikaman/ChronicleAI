// x402 Payment Adapter
// Implements the x402 (Base Sepolia EVM subscription) payment route.
// x402 uses ERC-20 permit/transfer patterns for subscription-based access.

import { randomUUID } from "node:crypto";
import { ethers } from "ethers";
import type {
  ChallengeResult,
  PaymentAdapter,
  SettlementVerificationResult,
} from "./payment-adapter.ts";

/** Base Sepolia chain ID and Circle official USDC for x402 EIP-712 domain. */
const X402_CHAIN_ID = 84_532;
const X402_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const CHALLENGE_EXPIRY_MS = 600_000; // 10 minutes

/**
 * x402 payment adapter.
 *
 * This adapter supports:
 * 1. Production EIP-712 typed data challenge generation and verification
 * 2. Fallback mode (opt-in via `allowTestMode`) for dev/test with plain-string settlement references
 */
export class X402PaymentAdapter implements PaymentAdapter {
  readonly route = "x402" as const;

  private readonly facilitatorUrl: string | undefined;
  private readonly treasuryWalletAddress: string | undefined;
  private readonly allowTestMode: boolean;

  constructor(options?: {
    facilitatorUrl?: string | undefined;
    treasuryWalletAddress?: string | undefined;
    /**
     * When true, the adapter will accept plain-string settlement references
     * without EIP-712 signature verification. Intended for local development
     * and integration tests only. Defaults to false.
     */
    allowTestMode?: boolean | undefined;
  }) {
    this.facilitatorUrl = options?.facilitatorUrl;
    this.treasuryWalletAddress = options?.treasuryWalletAddress;
    this.allowTestMode = options?.allowTestMode ?? false;
  }

  async createChallenge(params: {
    premiumItemId: string;
    amount: number;
    currency: string;
    payerReference?: string | undefined;
  }): Promise<ChallengeResult> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CHALLENGE_EXPIRY_MS).toISOString();

    const challengeReference = `x402_${randomUUID()}`;
    const nonce = ethers.keccak256(ethers.toUtf8Bytes(challengeReference));

    // Reconstruct domain (Base Sepolia USDC)
    const domain = {
      name: "USD Coin",
      version: "2",
      chainId: X402_CHAIN_ID,
      verifyingContract: X402_USDC,
    };

    const types = {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    };

    if (
      !this.treasuryWalletAddress ||
      !/^0x[a-fA-F0-9]{40}$/.test(this.treasuryWalletAddress)
    ) {
      throw new Error(
        "Treasury wallet address is not configured for x402 payments (TREASURY_WALLET_ADDRESS)",
      );
    }

    const treasuryTo = this.treasuryWalletAddress;
    // `from` is filled by the payer wallet at sign time when not pre-bound
    const message = {
      from:
        params.payerReference && /^0x[a-fA-F0-9]{40}$/.test(params.payerReference)
          ? params.payerReference
          : "0x0000000000000000000000000000000000000000",
      to: treasuryTo,
      value: Math.round(params.amount * 1_000_000), // Scale USDC to 6 decimals
      validAfter: 0,
      validBefore: Math.floor(new Date(expiresAt).getTime() / 1000),
      nonce,
    };

    const challengeData: Record<string, unknown> = {
      route: "x402",
      premiumItemId: params.premiumItemId,
      expectedAmount: params.amount,
      expectedCurrency: params.currency,
      facilitatorUrl: this.facilitatorUrl ?? null,
      referralAddress: params.payerReference ?? null,
      challengeType: "permit",
      domain,
      types,
      message,
    };

    return {
      challengeReference,
      paymentRoute: "x402",
      amountRequested: params.amount,
      currency: params.currency,
      expiresAt,
      challengeData,
    };
  }

  async verifySettlement(params: {
    challengeReference: string;
    settlementReference: string;
    amountRequested: number;
    currency: string;
    paymentRoute: string;
  }): Promise<SettlementVerificationResult> {
    if (params.paymentRoute !== "x402") {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage: "Invalid payment route for x402 adapter",
      };
    }

    if (!params.settlementReference) {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage: "Invalid settlement reference",
      };
    }

    // Try parsing as EIP-712 JSON payload
    try {
      if (params.settlementReference.trim().startsWith("{")) {
        const payload = JSON.parse(params.settlementReference);
        const { signature, from, to, value, validAfter, validBefore, nonce } = payload;

        if (
          !signature ||
          !from ||
          !to ||
          value === undefined ||
          validAfter === undefined ||
          validBefore === undefined ||
          !nonce
        ) {
          return {
            verified: false,
            amountSettled: 0,
            currency: params.currency,
            settlementReference: params.settlementReference,
            errorMessage: "Missing required EIP-712 parameters in settlement reference JSON",
          };
        }

        const domain = {
          name: "USD Coin",
          version: "2",
          chainId: X402_CHAIN_ID,
          verifyingContract: X402_USDC,
        };

        const types = {
          TransferWithAuthorization: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "validAfter", type: "uint256" },
            { name: "validBefore", type: "uint256" },
            { name: "nonce", type: "bytes32" },
          ],
        };

        const message = {
          from,
          to,
          value: BigInt(value).toString(),
          validAfter: Number(validAfter),
          validBefore: Number(validBefore),
          nonce,
        };

        // Recover signer using ethers
        const recoveredAddress = ethers.verifyTypedData(domain, types, message, signature);

        if (recoveredAddress.toLowerCase() !== from.toLowerCase()) {
          return {
            verified: false,
            amountSettled: 0,
            currency: params.currency,
            settlementReference: params.settlementReference,
            errorMessage:
              "Cryptographic signature verification failed: recovered address does not match from address",
          };
        }

        // Verify nonce matches expected challenge reference hash
        const expectedNonce = ethers.keccak256(ethers.toUtf8Bytes(params.challengeReference));
        if (nonce !== expectedNonce) {
          return {
            verified: false,
            amountSettled: 0,
            currency: params.currency,
            settlementReference: params.settlementReference,
            errorMessage: "Nonce mismatch: challengeReference hash does not match provided nonce",
          };
        }

        // Verify amount
        const expectedValue = Math.round(params.amountRequested * 1_000_000);
        if (BigInt(value) < BigInt(expectedValue)) {
          return {
            verified: false,
            amountSettled: Number(value) / 1_000_000,
            currency: params.currency,
            settlementReference: params.settlementReference,
            errorMessage: "Insufficient payment value in signature",
          };
        }

        return {
          verified: true,
          amountSettled: params.amountRequested,
          currency: params.currency,
          settlementReference: params.settlementReference,
          payerReference: from,
        };
      }
    } catch (err) {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage: `Failed to verify EIP-712 signature: ${err instanceof Error ? err.message : "unknown error"}`,
      };
    }

    // Fallback to local test mode when explicitly opted in via allowTestMode
    if (this.allowTestMode) {
      if (params.settlementReference.length < 5) {
        return {
          verified: false,
          amountSettled: 0,
          currency: params.currency,
          settlementReference: params.settlementReference,
          errorMessage: "Settlement reference is too short",
        };
      }

      const payerReference = `0x${params.settlementReference.slice(0, 40).padEnd(40, "0")}`;
      return {
        verified: true,
        amountSettled: params.amountRequested,
        currency: params.currency,
        settlementReference: params.settlementReference,
        payerReference,
      };
    }

    return {
      verified: false,
      amountSettled: 0,
      currency: params.currency,
      settlementReference: params.settlementReference,
      errorMessage:
        "Settlement requires a JSON serialized EIP-712 authorization payload. For test/development, construct the X402PaymentAdapter with { allowTestMode: true }",
    };
  }
}
