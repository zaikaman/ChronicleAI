// x402 Payment Adapter
// Implements the x402 (Base EVM subscription) payment route.
// x402 uses ERC-20 permit/transfer patterns for subscription-based access.

import { randomUUID } from "node:crypto";
import type { ChallengeResult, PaymentAdapter, SettlementVerificationResult } from "./payment-adapter.ts";

const CHALLENGE_EXPIRY_MS = 600_000; // 10 minutes

/**
 * x402 payment adapter.
 *
 * In production, this adapter would:
 * 1. Create an EIP-712 typed data challenge for the payer to sign
 * 2. Verify the signed permit/transfer on settlement
 * 3. Extract referral wallet attributes from the signed data
 *
 * For the hackathon, we use a deterministic local test mode:
 * - Challenge: generate UUID + expected payment details
 * - Settlement: accept any settlement reference with expected amount
 */
export class X402PaymentAdapter implements PaymentAdapter {
  readonly route = "x402" as const;

  private readonly facilitatorUrl: string | undefined;

  constructor(options?: { facilitatorUrl?: string | undefined }) {
    this.facilitatorUrl = options?.facilitatorUrl;
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

    // Route-specific data: in production this would include an EIP-712 typed data payload
    const challengeData: Record<string, unknown> = {
      route: "x402",
      premiumItemId: params.premiumItemId,
      expectedAmount: params.amount,
      expectedCurrency: params.currency,
      facilitatorUrl: this.facilitatorUrl ?? null,
      referralAddress: params.payerReference ?? null,
      // In production, this would be an EIP-712 typed data payload for the payer to sign
      challengeType: "permit",
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
    // In a production environment, this would:
    // 1. Decode the settlement reference as a signed EIP-712 payload
    // 2. Verify the signature against the expected amount and currency
    // 3. Extract the payer's wallet address as payerReference
    // 4. Check for affiliate/referral attributes in the signed data

    // For the hackathon test mode, simulate verification:
    // - If settlement reference is valid (non-empty), accept the payment
    // - Check that the route matches
    if (params.paymentRoute !== "x402") {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage: "Invalid payment route for x402 adapter",
      };
    }

    if (!params.settlementReference || params.settlementReference.length < 5) {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage: "Invalid settlement reference",
      };
    }

    // Simulate full settlement at requested amount
    const isFullAmount = Math.abs(params.amountRequested - params.amountRequested) < 0.01;

    if (!isFullAmount) {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage: "Settlement amount does not match requested amount",
      };
    }

    // Extract payer reference from settlement reference if available
    // In production this comes from the recovered signer address
    const payerReference = `0x${params.settlementReference.slice(0, 40).padEnd(40, "0")}`;

    return {
      verified: true,
      amountSettled: params.amountRequested,
      currency: params.currency,
      settlementReference: params.settlementReference,
      payerReference,
    };
  }
}
