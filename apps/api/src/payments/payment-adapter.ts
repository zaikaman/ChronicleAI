// Payment route abstraction shared by x402 and MPP adapters

import type { PaymentRoute } from "@chronicleai/schemas";

/**
 * Result of creating a payment challenge.
 */
export interface ChallengeResult {
  challengeReference: string;
  paymentRoute: PaymentRoute;
  amountRequested: number;
  currency: string;
  expiresAt: string;
  /** Route-specific challenge data (e.g., payment URL, invoice) */
  challengeData: Record<string, unknown>;
}

/**
 * Result of verifying a payment settlement.
 */
export interface SettlementVerificationResult {
  verified: boolean;
  amountSettled: number;
  currency: string;
  settlementReference: string;
  payerReference?: string | undefined;
  errorMessage?: string | undefined;
}

/**
 * Abstract interface for payment route adapters.
 * Each route (x402, MPP) implements this interface.
 */
export interface PaymentAdapter {
  /** The payment route identifier */
  readonly route: PaymentRoute;

  /**
   * Create a payment challenge for a given amount.
   * Optional `agreement` marks recurring products (e.g. monthly newsletter).
   */
  createChallenge(params: {
    premiumItemId: string;
    amount: number;
    currency: string;
    payerReference?: string | undefined;
    /**
     * Optional affiliate / referral partner wallet (not the payer).
     * Stored on the payment record and used for capped revenue routing.
     */
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
  }): Promise<ChallengeResult>;

  /**
   * Verify a settlement and return the verification result.
   */
  verifySettlement(params: {
    challengeReference: string;
    settlementReference: string;
    amountRequested: number;
    currency: string;
    paymentRoute: PaymentRoute;
    /**
     * Optional challenge-time payer from the payment record.
     * Used by routes (e.g. MPP) that cannot recover a payer from the settlement proof alone.
     */
    challengePayerReference?: string | null | undefined;
  }): Promise<SettlementVerificationResult>;
}
