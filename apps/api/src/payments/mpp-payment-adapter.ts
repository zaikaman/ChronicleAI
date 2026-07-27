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
 * Production mode requires a configured shared secret and exact HMAC match.
 * Opt-in `allowTestMode` enables a local test secret and length-based bypass
 * for unit/integration tests only — never enable in production wiring.
 */
export class MppPaymentAdapter implements PaymentAdapter {
  readonly route = "mpp" as const;

  private readonly mppSecret: string | undefined;
  private readonly allowTestMode: boolean;

  constructor(options?: {
    mppSecret?: string | undefined;
    /**
     * When true, accepts a default test secret when none is configured and
     * allows non-matching HMAC strings of length ≥ 32. Defaults to false.
     */
    allowTestMode?: boolean | undefined;
  }) {
    this.mppSecret = options?.mppSecret;
    this.allowTestMode = options?.allowTestMode ?? false;
  }

  private resolveSecret(): string | undefined {
    if (this.mppSecret) return this.mppSecret;
    if (this.allowTestMode) return "mpp-test-secret";
    return undefined;
  }

  async createChallenge(params: {
    premiumItemId: string;
    amount: number;
    currency: string;
    payerReference?: string | undefined;
  }): Promise<ChallengeResult> {
    const secret = this.resolveSecret();
    if (!secret) {
      throw new Error("MPP secret key is not configured on the server (MPP_SECRET)");
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + CHALLENGE_EXPIRY_MS).toISOString();

    const challengeNonce = randomUUID();
    const challengeReference = `mpp_${challengeNonce}`;

    const hmacPayload = `${challengeReference}|${params.amount}|${params.currency}|${expiresAt}`;
    const expectedHmac = createHmac("sha256", secret).update(hmacPayload).digest("hex");

    const challengeData: Record<string, unknown> = {
      route: "mpp",
      premiumItemId: params.premiumItemId,
      expectedAmount: params.amount,
      expectedCurrency: params.currency,
      challengeNonce,
      // HMAC material the machine client must recompute with the shared secret.
      // The full expected HMAC is not exposed — clients compute it themselves.
      hmacPayloadTemplate: `${challengeReference}|${params.amount}|${params.currency}|${expiresAt}`,
      expiresAt,
      verificationType: "hmac_sha256",
    };

    // Keep expectedHmac available only in test mode so unit tests can assert shape
    // without shipping the answer in production challenge payloads.
    if (this.allowTestMode) {
      challengeData.expectedHmac = expectedHmac;
    }

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
    if (params.paymentRoute !== "mpp") {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage: "Invalid payment route for MPP adapter",
      };
    }

    if (!params.settlementReference || params.settlementReference.length < 10) {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage: "Invalid settlement reference",
      };
    }

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

    const secret = this.resolveSecret();
    if (!secret) {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage: "MPP secret key is not configured on the server",
      };
    }

    const hmacPayload = `${params.challengeReference}|${params.amountRequested}|${params.currency}|${expiresAt}`;
    const expectedHmac = createHmac("sha256", secret).update(hmacPayload).digest("hex");

    const isMatch = providedHmac === expectedHmac;

    if (!isMatch) {
      // Explicit opt-in test bypass only (mirrors x402 allowTestMode)
      if (this.allowTestMode && providedHmac.length >= 32) {
        // fall through as verified for test adapters
      } else {
        return {
          verified: false,
          amountSettled: 0,
          currency: params.currency,
          settlementReference: params.settlementReference,
          errorMessage: "HMAC signature verification failed",
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
