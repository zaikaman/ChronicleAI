// Chronicle Pass management service (wallet-scoped self-service).
//
// Evolves the recurring x402 newsletter infrastructure into the user-facing
// Chronicle Pass without renaming the underlying tables in v1. Every method is
// scoped to the authenticated wallet, and entitlement is re-derived from the
// stored agreement on each call (never from a client-held token).

import type {
  EmailSubscriberRepository,
  NewsletterSubscriptionRepository,
  NewsletterSubscriptionRow,
  PaymentRecordRepository,
  PaymentRecordRow,
  PremiumIntelligenceRepository,
} from "@chronicleai/db";
import {
  isNewsletterEntitled,
  isValidSubscriberEmail,
  normalizeWalletAddress,
} from "@chronicleai/db";
import type {
  ChroniclePassPaymentHistoryItem,
  ChroniclePassPreferences,
  ChroniclePassStatus,
  ChroniclePassStatusResponse,
} from "@chronicleai/schemas";
import { badRequest } from "../errors.ts";
import type {
  NewsletterChallengeResult,
  NewsletterSettleResult,
  NewsletterSubscriptionService,
} from "./newsletter-subscription-service.ts";

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/** Map a stored agreement to the user-facing Chronicle Pass lifecycle state. */
export function derivePassStatus(sub: NewsletterSubscriptionRow | null): ChroniclePassStatus {
  if (!sub) return "none";
  switch (sub.status) {
    case "pending":
      return "pending";
    case "past_due":
      return "past_due";
    case "cancelled":
      return "cancelled";
    case "expired":
      return "expired";
    case "active":
      return sub.cancel_at_period_end ? "canceling" : "active";
    default:
      return "none";
  }
}

function toPaymentHistoryItem(payment: PaymentRecordRow): ChroniclePassPaymentHistoryItem {
  return {
    id: payment.id,
    status: payment.status,
    paymentRoute: payment.payment_route,
    amountRequested: payment.amount_requested ?? null,
    amountSettled: payment.amount_settled ?? null,
    currency: payment.currency ?? null,
    requestedAt: payment.requested_at ?? null,
    settledAt: payment.settled_at ?? null,
    settlementReference: payment.settlement_reference ?? null,
    registryTxHash: payment.registry_tx_hash ?? null,
    explorerUrl: payment.explorer_url ?? null,
  };
}

export interface ChroniclePassServiceDeps {
  newsletterService: NewsletterSubscriptionService;
  newsletterRepo: NewsletterSubscriptionRepository;
  paymentRecordRepo: PaymentRecordRepository;
  subscriberRepo: EmailSubscriberRepository;
  premiumRepo: PremiumIntelligenceRepository;
  /** Canonical monthly price used for display + challenge amounts. */
  monthlyPriceUsdc: number;
}

export class ChroniclePassService {
  private readonly newsletterService: NewsletterSubscriptionService;
  private readonly newsletterRepo: NewsletterSubscriptionRepository;
  private readonly paymentRecordRepo: PaymentRecordRepository;
  private readonly subscriberRepo: EmailSubscriberRepository;
  private readonly premiumRepo: PremiumIntelligenceRepository;
  private readonly monthlyPriceUsdc: number;

  constructor(deps: ChroniclePassServiceDeps) {
    this.newsletterService = deps.newsletterService;
    this.newsletterRepo = deps.newsletterRepo;
    this.paymentRecordRepo = deps.paymentRecordRepo;
    this.subscriberRepo = deps.subscriberRepo;
    this.premiumRepo = deps.premiumRepo;
    this.monthlyPriceUsdc = deps.monthlyPriceUsdc;
  }

  private async requireSubscriptionForWallet(wallet: string): Promise<NewsletterSubscriptionRow> {
    const sub = await this.findByWallet(wallet);
    if (!sub) {
      throw badRequest("No Chronicle Pass subscription found for this wallet");
    }
    return sub;
  }

  private async findByWallet(wallet: string): Promise<NewsletterSubscriptionRow | null> {
    const result = await this.newsletterRepo.findByPayerWallet(wallet);
    if (!result.ok) {
      throw badRequest(result.error.message);
    }
    return result.value;
  }

  /** Full self-service status for the authenticated wallet. */
  async getStatusForWallet(wallet: string): Promise<ChroniclePassStatusResponse> {
    const sub = await this.findByWallet(wallet);
    const preferences: ChroniclePassPreferences = {
      email: sub?.email ?? "",
      receivesDigests: !!sub?.email_subscriber_id,
      receivesAlerts: !!sub?.email_subscriber_id,
    };

    if (sub?.email) {
      // Prefer live email-subscriber preferences when a record exists.
      const subscriberResult = await this.subscriberRepo.findByEmail(sub.email);
      if (subscriberResult.ok && subscriberResult.value) {
        preferences.receivesDigests = subscriberResult.value.receives_digests;
        preferences.receivesAlerts = subscriberResult.value.receives_alerts;
      }
    }

    const passStatus = derivePassStatus(sub);
    return {
      subscriptionId: sub?.id ?? null,
      passStatus,
      entitled: sub ? isNewsletterEntitled(sub) : false,
      amountPerPeriod: sub?.amount_per_period ?? this.monthlyPriceUsdc,
      currency: sub?.currency ?? "USDC",
      billingPeriodDays: sub?.billing_period_days ?? 30,
      currentPeriodStart: sub?.current_period_start ?? null,
      currentPeriodEnd: sub?.current_period_end ?? null,
      nextRenewalAt: sub?.next_renewal_at ?? null,
      periodsPaid: sub?.periods_paid ?? 0,
      payerWallet: sub?.payer_wallet ?? null,
      cancelAtPeriodEnd: sub?.cancel_at_period_end ?? false,
      cancelledAt: sub?.cancelled_at ?? null,
      lastSettledAt: sub?.last_settled_at ?? null,
      ...preferences,
    };
  }

  /** Entitlement snapshot used by premium access gates (checked per request). */
  async resolveEntitlement(wallet: string): Promise<{
    entitled: boolean;
    passStatus: ChroniclePassStatus;
    subscriptionId: string | null;
  }> {
    const sub = await this.findByWallet(wallet);
    return {
      entitled: sub ? isNewsletterEntitled(sub) : false,
      passStatus: derivePassStatus(sub),
      subscriptionId: sub?.id ?? null,
    };
  }

  /** Update delivery email and/or digest/alert preferences. */
  async updatePreferences(params: {
    wallet: string;
    email?: string | undefined;
    receivesDigests?: boolean | undefined;
    receivesAlerts?: boolean | undefined;
  }): Promise<ChroniclePassStatusResponse> {
    const sub = await this.requireSubscriptionForWallet(params.wallet);

    const email = params.email?.trim() ?? sub.email;
    if (params.email !== undefined && !isValidSubscriberEmail(email)) {
      throw badRequest("Invalid email address");
    }

    const oldEmail = sub.email;
    if (params.email !== undefined && email !== oldEmail) {
      const updated = await this.newsletterRepo.update(sub.id, { email });
      if (!updated.ok) throw badRequest(`Failed to update email: ${updated.error.message}`);
    }

    const receivesDigests = params.receivesDigests ?? true;
    const receivesAlerts = params.receivesAlerts ?? true;
    const enrollment = await this.subscriberRepo.subscribe({
      email,
      receivesDigests,
      receivesAlerts,
      source: "premium",
      payerReference: params.wallet,
    });
    if (!enrollment.ok) {
      throw badRequest(`Failed to update delivery preferences: ${enrollment.error.message}`);
    }

    // Unsubscribe the previous address so digests/alerts never double-deliver.
    if (params.email !== undefined && email !== oldEmail && oldEmail) {
      await this.subscriberRepo.unsubscribeByEmail(oldEmail).catch(() => {});
    }

    return this.getStatusForWallet(params.wallet);
  }

  /** Cancel at period end — access continues until current_period_end. */
  async cancelAtPeriodEnd(wallet: string): Promise<ChroniclePassStatusResponse> {
    const sub = await this.requireSubscriptionForWallet(wallet);
    if (!isNewsletterEntitled(sub)) {
      throw badRequest("Only an active or past-due subscription can be cancelled");
    }
    if (!sub.cancel_at_period_end) {
      const updated = await this.newsletterRepo.update(sub.id, { cancel_at_period_end: true });
      if (!updated.ok) throw badRequest(`Failed to cancel: ${updated.error.message}`);
    }
    return this.getStatusForWallet(wallet);
  }

  /** Resume a cancel-at-period-end subscription (before the period ends). */
  async resume(wallet: string): Promise<ChroniclePassStatusResponse> {
    const sub = await this.requireSubscriptionForWallet(wallet);
    if (sub.cancel_at_period_end) {
      const updated = await this.newsletterRepo.update(sub.id, { cancel_at_period_end: false });
      if (!updated.ok) throw badRequest(`Failed to resume: ${updated.error.message}`);
    }
    return this.getStatusForWallet(wallet);
  }

  /** Issue a wallet-authorized x402 renewal challenge (user-initiated, no silent charges). */
  async renew(wallet: string): Promise<NewsletterChallengeResult> {
    const sub = await this.requireSubscriptionForWallet(wallet);
    void sub;
    return this.newsletterService.renewForWallet({ wallet });
  }

  /** Activate a renewal period after the wallet settles the x402 challenge. */
  async settle(params: {
    wallet: string;
    challengeReference: string;
    settlementReference: string;
  }): Promise<NewsletterSettleResult> {
    const sub = await this.requireSubscriptionForWallet(params.wallet);
    if (
      !sub.pending_challenge_reference ||
      sub.pending_challenge_reference !== params.challengeReference.trim()
    ) {
      throw badRequest("No pending renewal challenge matches this reference");
    }
    return this.newsletterService.settle({
      challengeReference: params.challengeReference,
      settlementReference: params.settlementReference,
    });
  }

  /** Start a new Chronicle Pass from a wallet + email (initial period). */
  async startSubscribe(params: {
    wallet: string;
    email: string;
  }): Promise<NewsletterChallengeResult> {
    return this.newsletterService.startSubscribe({
      email: params.email,
      payerReference: params.wallet,
    });
  }

  /** Bounded, newest-first payment history for the wallet. */
  async listPayments(wallet: string, limitParam = 20): Promise<ChroniclePassPaymentHistoryItem[]> {
    const normalized = normalizeWalletAddress(wallet);
    if (!normalized || !EVM_ADDRESS_RE.test(normalized)) {
      throw badRequest("Invalid wallet address");
    }
    const result = await this.paymentRecordRepo.listByPayer(normalized, limitParam);
    if (!result.ok) {
      throw badRequest(`Failed to load payment history: ${result.error.message}`);
    }
    return result.value.map(toPaymentHistoryItem);
  }
}

export function createChroniclePassService(deps: ChroniclePassServiceDeps): ChroniclePassService {
  return new ChroniclePassService(deps);
}
