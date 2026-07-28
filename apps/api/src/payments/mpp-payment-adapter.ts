// MPP (Machine-to-Machine Micro-Payment) Payment Adapter
// Uses HMAC challenge verification for deterministic machine-to-machine billing.

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  ChallengeResult,
  PaymentAdapter,
  SettlementVerificationResult,
} from "./payment-adapter.ts";

const CHALLENGE_EXPIRY_MS = 300_000; // 5 minutes for machine payments

/** Max allowed skew when comparing settlement expiresAt to challenge expires_at (ms). */
const EXPIRY_MATCH_SKEW_MS = 2_000;

function hmacEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/** EVM address used as a real payout / referral identity. */
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/**
 * Resolve a real payout identity for MPP settlements.
 * Prefer an EVM address from challenge-time payerReference so revenue-routing
 * referral transfers can pay out on-chain. Synthetic mpp-client-* ids are never
 * returned — those cannot receive on-chain transfers.
 */
export function resolveMppPayerReference(
  challengePayerReference?: string | null,
): string | undefined {
  if (!challengePayerReference) return undefined;
  const trimmed = challengePayerReference.trim();
  if (!trimmed) return undefined;
  if (EVM_ADDRESS_RE.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  // Non-address machine ids are accepted for access scoping but not invented here.
  // Only pass through stable client-supplied identifiers (not synthetic expiresAt slices).
  if (trimmed.startsWith("mpp-client-")) {
    return undefined;
  }
  return trimmed;
}

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
    /** Affiliate wallet from intent metadata — never the machine payer id. */
    referralAddress?: string | null | undefined;
    agreement?:
      | {
          type: "recurring_newsletter";
          billingPeriodDays: number;
          subscriptionId?: string | undefined;
          periodKind: "initial" | "renewal";
          referralAddress?: string | null | undefined;
        }
      | undefined;
  }): Promise<ChallengeResult> {
    // MPP is one-shot micro-billing; agreement product fields are ignored.
    // Referral intent is still accepted for affiliate attribution on settle.
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

    const resolvedPayer = resolveMppPayerReference(params.payerReference);

    const referralCandidates = [
      params.agreement?.referralAddress,
      params.referralAddress,
    ];
    const referralFromIntent = referralCandidates.find(
      (addr): addr is string =>
        typeof addr === "string" && EVM_ADDRESS_RE.test(addr.trim()),
    );
    const referralAddress = referralFromIntent
      ? referralFromIntent.trim().toLowerCase()
      : null;

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
      ...(resolvedPayer ? { payerReference: resolvedPayer } : {}),
      referralAddress,
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
    /** Challenge-time payer (from payment_records) for real payout identity mapping. */
    challengePayerReference?: string | null | undefined;
    /**
     * Canonical challenge expiry from payment_records.expires_at.
     * When provided, settlement expiresAt must match (within small skew).
     */
    challengeExpiresAt?: string | null | undefined;
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

    // Enforce settlement / challenge expiry before cryptographic checks are treated as success.
    const expiresMs = Date.parse(expiresAt);
    if (Number.isNaN(expiresMs)) {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage: "Invalid expiresAt in settlement reference",
      };
    }
    if (expiresMs < Date.now()) {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage: "Settlement challenge has expired (expiresAt)",
      };
    }

    // Bind settlement material to the persisted challenge expiry (x402-style rail hygiene).
    if (params.challengeExpiresAt) {
      const challengeMs = Date.parse(params.challengeExpiresAt);
      if (Number.isNaN(challengeMs)) {
        return {
          verified: false,
          amountSettled: 0,
          currency: params.currency,
          settlementReference: params.settlementReference,
          errorMessage: "Invalid challenge expires_at on payment record",
        };
      }
      if (Math.abs(challengeMs - expiresMs) > EXPIRY_MATCH_SKEW_MS) {
        return {
          verified: false,
          amountSettled: 0,
          currency: params.currency,
          settlementReference: params.settlementReference,
          errorMessage:
            "Settlement expiresAt does not match challenge expires_at (replay/mismatch)",
        };
      }
      if (challengeMs < Date.now()) {
        return {
          verified: false,
          amountSettled: 0,
          currency: params.currency,
          settlementReference: params.settlementReference,
          errorMessage: "Challenge has expired (payment_records.expires_at)",
        };
      }
    }

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

    const isMatch = hmacEqual(providedHmac, expectedHmac);

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

    // Map to a real payout identity when the challenge was created with an EVM address.
    // Never invent synthetic mpp-client-* ids (those skip on-chain referral transfers).
    const payerReference = resolveMppPayerReference(params.challengePayerReference);

    return {
      verified: true,
      amountSettled: params.amountRequested,
      currency: params.currency,
      settlementReference: params.settlementReference,
      ...(payerReference ? { payerReference } : {}),
    };
  }
}
