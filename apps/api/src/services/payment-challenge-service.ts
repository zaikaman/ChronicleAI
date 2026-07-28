// Payment Challenge Service
// Handles route validation, pricing, challenge expiry, and record creation.

import type {
  AffiliateRepository,
  PaymentRecordRepository,
  PremiumIntelligenceItemRow,
} from "@chronicleai/db";
import type { PaymentRoute } from "@chronicleai/schemas";
import { PAYMENT_ROUTES } from "@chronicleai/schemas";
import type { PaymentAdapter } from "../payments/payment-adapter.ts";
import type { ChallengeResult } from "../payments/payment-adapter.ts";

export interface ChallengeServiceResult {
  challenge: ChallengeResult;
  paymentRecordId: string;
}

export class PaymentChallengeService {
  private readonly paymentRecordRepo: PaymentRecordRepository;
  private readonly adapters: Map<PaymentRoute, PaymentAdapter>;
  private readonly affiliateRepo: AffiliateRepository | null;

  constructor(params: {
    paymentRecordRepo: PaymentRecordRepository;
    adapters: Map<PaymentRoute, PaymentAdapter>;
    /** When set, referralAddress must resolve to an approved affiliate. */
    affiliateRepo?: AffiliateRepository | null;
  }) {
    this.paymentRecordRepo = params.paymentRecordRepo;
    this.adapters = params.adapters;
    this.affiliateRepo = params.affiliateRepo ?? null;
  }

  /**
   * Validate that the requested payment route is supported.
   */
  validateRoute(route: string): route is PaymentRoute {
    return PAYMENT_ROUTES.includes(route as PaymentRoute);
  }

  /**
   * Validate that the premium item supports the requested route.
   */
  validateRouteForItem(item: PremiumIntelligenceItemRow, route: PaymentRoute): boolean {
    return item.payment_routes.includes(route);
  }

  /**
   * Validate that the premium item is available for purchase.
   */
  validateItemAvailable(item: PremiumIntelligenceItemRow): boolean {
    return item.status === "available";
  }

  /**
   * Create a payment challenge for a premium item using the specified route.
   * Persists adapter `expiresAt` so settlement can reject stale challenges.
   */
  async createChallenge(params: {
    premiumItem: PremiumIntelligenceItemRow;
    paymentRoute: PaymentRoute;
    payerReference?: string | undefined;
    /** Optional affiliate wallet from intent (not the payer). */
    referralAddress?: string | null | undefined;
  }): Promise<ChallengeServiceResult> {
    const adapter = this.adapters.get(params.paymentRoute);
    if (!adapter) {
      throw new Error(`Unsupported payment route: ${params.paymentRoute}`);
    }

    let resolvedReferral: string | null = params.referralAddress?.trim()
      ? params.referralAddress.trim()
      : null;

    if (resolvedReferral && this.affiliateRepo) {
      const approved = await this.affiliateRepo.findApprovedByWalletOrCode(resolvedReferral);
      if (!approved.ok) {
        throw new Error(approved.error.message);
      }
      if (!approved.value) {
        throw new Error(
          "referralAddress must be an approved affiliate (register via POST /affiliates)",
        );
      }
      resolvedReferral = approved.value.wallet_address;
    }

    // Generate challenge via adapter
    const challenge = await adapter.createChallenge({
      premiumItemId: params.premiumItem.id,
      amount: params.premiumItem.price_amount,
      currency: params.premiumItem.price_currency,
      payerReference: params.payerReference ?? undefined,
      referralAddress: resolvedReferral,
    });

    const challengeReferral =
      typeof challenge.challengeData.referralAddress === "string"
        ? challenge.challengeData.referralAddress
        : resolvedReferral;

    // Record the challenge in the database (including expiry from the adapter)
    const result = await this.paymentRecordRepo.createChallenge({
      premium_item_id: params.premiumItem.id,
      payment_route: params.paymentRoute,
      payer_reference: params.payerReference ?? null,
      referral_address: challengeReferral,
      amount_requested: params.premiumItem.price_amount,
      currency: params.premiumItem.price_currency,
      status: "challenge_issued",
      challenge_reference: challenge.challengeReference,
      requested_at: new Date().toISOString(),
      expires_at: challenge.expiresAt,
    });

    if (!result.ok) {
      throw new Error(`Failed to create payment record: ${result.error.message}`);
    }

    return {
      challenge,
      paymentRecordId: result.value.id,
    };
  }
}
