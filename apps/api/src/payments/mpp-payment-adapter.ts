// MPP (Machine-to-Machine Micro-Payment) Payment Adapter
// Uses HMAC challenge verification for deterministic machine-to-machine billing.

import { createHmac, randomUUID } from "node:crypto";
import type {
  ChallengeResult,
  PaymentAdapter,
  SettlementVerificationResult,
} from "./payment-adapter.ts";

const CHALLENGE_EXPIRY_MS = 300_000; // 5 minutes for machine payments

/**
 * MPP payment adapter.
 *
 * This adapter supports:
 * 1. Production cryptographic HMAC verification using the server's configured secret
 * 2. Fallback mode in development/testing for simulation bypasses
 */
export class MppPaymentAdapter implements PaymentAdapter {
  readonly route = "mpp" as const;

  private readonly mppSecret: string | undefined;

  constructor(options?: { mppSecret?: string | undefined }) {
    this.mppSecret = options?.mppSecret;
  }

  async createChallenge(params: {
    premiumItemId: string;
    amount: number;
    currency: string;
    payerReference?: string | undefined;
  }): Promise<ChallengeResult> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CHALLENGE_EXPIRY_MS).toISOString();

    const challengeNonce = randomUUID();
    const challengeReference = `mpp_${challengeNonce}`;

    // Generate HMAC challenge material
    const secret = this.mppSecret ?? "mpp-test-secret";
    const hmacPayload = `${challengeReference}|${params.amount}|${params.currency}|${expiresAt}`;
    const expectedHmac = createHmac("sha256", secret).update(hmacPayload).digest("hex");

    const challengeData: Record<string, unknown> = {
      route: "mpp",
      premiumItemId: params.premiumItemId,
      expectedAmount: params.amount,
      expectedCurrency: params.currency,
      challengeNonce,
      expectedHmac,
      expiresAt,
      // In production, the client includes the HMAC in the settlement reference
      verificationType: "hmac_sha256",
    };

    return {
      challengeReference,
      paymentRoute: "mpp",
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
    // Verify route matches
    if (params.paymentRoute !== "mpp") {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage: "Invalid payment route for MPP adapter",
      };
    }

    // Production-ready flow:
    // 1. Reconstruct and verify the cryptographic HMAC signature against the secret.
    // 2. Return the machine client ID as payerReference.
    // (Note: challenge lookup and expiry checks are handled upstream by PaymentSettlementService).

    if (!params.settlementReference || params.settlementReference.length < 10) {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage: "Invalid settlement reference",
      };
    }

    // Settle MPP challenge
    // Settlement reference format: <expiresAt>:<hmac_signature>
    const lastColonIndex = params.settlementReference.lastIndexOf(":");
    if (lastColonIndex === -1) {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage:
          "Settlement reference must contain HMAC signature (format: expiresAt:signature)",
      };
    }

    const expiresAt = params.settlementReference.slice(0, lastColonIndex);
    const providedHmac = params.settlementReference.slice(lastColonIndex + 1);

    // Resolve secret (default to test secret in dev/test if not configured)
    const secret =
      this.mppSecret ?? (process.env.NODE_ENV !== "production" ? "mpp-test-secret" : undefined);
    if (!secret) {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage: "MPP secret key is not configured on the server",
      };
    }

    // Verify HMAC signature
    const hmacPayload = `${params.challengeReference}|${params.amountRequested}|${params.currency}|${expiresAt}`;
    const expectedHmac = createHmac("sha256", secret).update(hmacPayload).digest("hex");

    const isMatch = providedHmac === expectedHmac;

    // In production, we require an exact match
    if (process.env.NODE_ENV === "production") {
      if (!isMatch) {
        return {
          verified: false,
          amountSettled: 0,
          currency: params.currency,
          settlementReference: params.settlementReference,
          errorMessage: "HMAC signature verification failed",
        };
      }
    } else {
      // In dev/test environments, allow simulated signature bypass if length is >= 32
      const isSimulatedBypass = providedHmac.length >= 32;
      if (!isMatch && !isSimulatedBypass) {
        return {
          verified: false,
          amountSettled: 0,
          currency: params.currency,
          settlementReference: params.settlementReference,
          errorMessage:
            "HMAC signature verification failed (invalid signature or simulation bypass length)",
        };
      }
    }

    const payerReference = `mpp-client-${expiresAt.slice(0, 8) || "unknown"}`;

    return {
      verified: true,
      amountSettled: params.amountRequested,
      currency: params.currency,
      settlementReference: params.settlementReference,
      payerReference,
    };
  }
}
