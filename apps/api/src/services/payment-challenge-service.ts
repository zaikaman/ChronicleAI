// Payment Challenge Service
// Handles route validation, pricing, challenge expiry, and record creation.

import type {
  AffiliateRepository,
  PaymentRecordRepository,
  PremiumIntelligenceItemRow,
  ReferralAttributionRepository,
} from "@chronicleai/db";
import { normalizeAffiliateWallet } from "@chronicleai/db";
import type { PaymentRoute } from "@chronicleai/schemas";
import { PAYMENT_ROUTES } from "@chronicleai/schemas";
import type { PaymentAdapter } from "../payments/payment-adapter.ts";
import type { ChallengeResult } from "../payments/payment-adapter.ts";

export type AutoRouteReason =
  | "explicit_x402"
  | "explicit_mpp"
  | "auto_selected_mpp"
  | "auto_selected_x402";

export interface ResolvedPaymentRoute {
  paymentRoute: PaymentRoute;
  reason: AutoRouteReason;
}

export interface ChallengeServiceResult {
  challenge: ChallengeResult;
  paymentRecordId: string;
  autoSelectReason: AutoRouteReason;
}

export class PaymentChallengeService {
  private readonly paymentRecordRepo: PaymentRecordRepository;
  private readonly adapters: Map<PaymentRoute, PaymentAdapter>;
  private readonly affiliateRepo: AffiliateRepository | null;
  private readonly attributionRepo: ReferralAttributionRepository | null;

  constructor(params: {
    paymentRecordRepo: PaymentRecordRepository;
    adapters: Map<PaymentRoute, PaymentAdapter>;
    /** When set, referralAddress must resolve to an approved affiliate. */
    affiliateRepo?: AffiliateRepository | null;
    /** Wallet-connect first-touch attribution (preferred over explicit referral). */
    attributionRepo?: ReferralAttributionRepository | null;
  }) {
    this.paymentRecordRepo = params.paymentRecordRepo;
    this.adapters = params.adapters;
    this.affiliateRepo = params.affiliateRepo ?? null;
    this.attributionRepo = params.attributionRepo ?? null;
  }

  /**
   * Validate that the requested payment route is supported (including 'auto').
   */
  validateRoute(route: string): route is PaymentRoute | "auto" {
    return route === "auto" || PAYMENT_ROUTES.includes(route as PaymentRoute);
  }

  /**
   * Resolve an explicit or 'auto' route selection into a concrete PaymentRoute and reason.
   */
  resolveAutoRoute(params: {
    paymentRoute?: string | undefined;
    payerReference?: string | undefined;
    chronicleClientHeader?: string | undefined;
    clientType?: string | undefined;
  }): ResolvedPaymentRoute {
    const route = params.paymentRoute?.toLowerCase().trim();
    if (route === "x402") {
      return { paymentRoute: "x402", reason: "explicit_x402" };
    }
    if (route === "mpp") {
      return { paymentRoute: "mpp", reason: "explicit_mpp" };
    }

    // Auto or omitted route logic
    const payerRef = params.payerReference?.toLowerCase().trim();
    const isMppRef = Boolean(payerRef && (payerRef.startsWith("mpp-") || payerRef.startsWith("agent-")));
    const isAgentHeader = params.chronicleClientHeader?.toLowerCase().trim() === "agent";
    const isMachineClient = params.clientType?.toLowerCase().trim() === "machine";

    if (isAgentHeader || isMachineClient || isMppRef) {
      return { paymentRoute: "mpp", reason: "auto_selected_mpp" };
    }

    return { paymentRoute: "x402", reason: "auto_selected_x402" };
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
   * Create a payment challenge for a premium item using the specified or auto-resolved route.
   * Persists adapter `expiresAt` so settlement can reject stale challenges.
   */
  async createChallenge(params: {
    premiumItem: PremiumIntelligenceItemRow;
    paymentRoute?: PaymentRoute | "auto" | string | undefined;
    payerReference?: string | undefined;
    chronicleClientHeader?: string | undefined;
    clientType?: string | undefined;
    /** Optional affiliate wallet from intent (not the payer). */
    referralAddress?: string | null | undefined;
  }): Promise<ChallengeServiceResult> {
    const resolved = this.resolveAutoRoute({
      paymentRoute: params.paymentRoute,
      payerReference: params.payerReference,
      chronicleClientHeader: params.chronicleClientHeader,
      clientType: params.clientType,
    });

    const adapter = this.adapters.get(resolved.paymentRoute);
    if (!adapter) {
      throw new Error(`Unsupported payment route: ${resolved.paymentRoute}`);
    }

    if (!this.validateRouteForItem(params.premiumItem, resolved.paymentRoute)) {
      throw new Error(
        `Premium item does not support payment route: ${resolved.paymentRoute}`,
      );
    }

    // Prefer sticky first-touch attribution from wallet connect over explicit intent.
    let resolvedReferral: string | null = null;
    const payer = normalizeAffiliateWallet(params.payerReference ?? null);
    if (payer && this.attributionRepo) {
      const attr = await this.attributionRepo.findByReferredWallet(payer);
      if (attr.ok && attr.value) {
        resolvedReferral = attr.value.affiliate_wallet;
      }
    }

    if (!resolvedReferral && params.referralAddress?.trim()) {
      resolvedReferral = params.referralAddress.trim();
    }

    if (resolvedReferral && this.affiliateRepo) {
      const approved = await this.affiliateRepo.findApprovedByWalletOrCode(resolvedReferral);
      if (!approved.ok) {
        throw new Error(approved.error.message);
      }
      if (!approved.value) {
        // Soft-drop invalid explicit referral rather than failing a paid purchase.
        // Attribution-sourced wallets should always be approved; if not, clear.
        if (params.referralAddress?.trim()) {
          throw new Error(
            "referralAddress must be an approved affiliate (register via POST /affiliates)",
          );
        }
        resolvedReferral = null;
      } else {
        resolvedReferral = approved.value.wallet_address;
      }
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
      payment_route: resolved.paymentRoute,
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
      autoSelectReason: resolved.reason,
    };
  }
}
