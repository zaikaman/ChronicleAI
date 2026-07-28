// Recurring x402 monthly newsletter subscription service.
// Manages agreements, billing periods, renewals, and premium digest entitlement.

import type {
  AffiliateRepository,
  EmailSubscriberRepository,
  ExecutionLogRepository,
  NewsletterSubscriptionRepository,
  NewsletterSubscriptionRow,
  PaymentRecordRepository,
  PremiumIntelligenceItemRow,
  PremiumIntelligenceRepository,
} from "@chronicleai/db";
import {
  isNewsletterEntitled,
  isValidSubscriberEmail,
  normalizeSubscriberEmail,
  normalizeWalletAddress,
} from "@chronicleai/db";
import type { NewsletterSubscriptionStatus } from "@chronicleai/schemas";
import {
  DEFAULT_NEWSLETTER_BILLING_PERIOD_DAYS,
  DEFAULT_NEWSLETTER_GRACE_PERIOD_DAYS,
  MONTHLY_NEWSLETTER_SLUG,
} from "@chronicleai/schemas";
import { badRequest } from "../errors.ts";
import type { PaymentAdapter } from "../payments/payment-adapter.ts";
import type { ChallengeResult } from "../payments/payment-adapter.ts";
import { PaymentSettlementService } from "./payment-settlement-service.ts";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface NewsletterSubscriptionConfig {
  monthlyPriceUsdc: number;
  billingPeriodDays: number;
  gracePeriodDays: number;
}

export interface NewsletterChallengeResult {
  subscription: NewsletterSubscriptionRow;
  challenge: ChallengeResult;
  paymentRecordId: string;
  periodKind: "initial" | "renewal";
}

export interface NewsletterSettleResult {
  settled: boolean;
  subscription: NewsletterSubscriptionRow;
  paymentRecordId: string;
  verification: {
    amountSettled: number;
    currency: string;
    settlementReference: string;
    payerReference?: string | undefined;
    errorMessage?: string | undefined;
  };
}

export interface NewsletterBillingSweepResult {
  pastDue: number;
  expired: number;
  cancelledAtPeriodEnd: number;
  errors: string[];
}

export function toNewsletterSubscriptionResponse(sub: NewsletterSubscriptionRow) {
  return {
    id: sub.id,
    email: sub.email,
    status: sub.status,
    amountPerPeriod: sub.amount_per_period,
    currency: sub.currency,
    billingPeriodDays: sub.billing_period_days,
    currentPeriodStart: sub.current_period_start,
    currentPeriodEnd: sub.current_period_end,
    nextRenewalAt: sub.next_renewal_at,
    periodsPaid: sub.periods_paid,
    payerWallet: sub.payer_wallet,
    referralAddress: sub.referral_address,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    cancelledAt: sub.cancelled_at,
    lastSettledAt: sub.last_settled_at,
    entitled: isNewsletterEntitled(sub),
  };
}

export class NewsletterSubscriptionService {
  private readonly newsletterRepo: NewsletterSubscriptionRepository;
  private readonly premiumRepo: PremiumIntelligenceRepository;
  private readonly paymentRecordRepo: PaymentRecordRepository;
  private readonly subscriberRepo: EmailSubscriberRepository;
  private readonly execLogRepo: ExecutionLogRepository;
  private readonly x402Adapter: PaymentAdapter;
  private readonly settlementService: PaymentSettlementService;
  private readonly affiliateRepo: AffiliateRepository | null;
  private readonly config: NewsletterSubscriptionConfig;

  constructor(params: {
    newsletterRepo: NewsletterSubscriptionRepository;
    premiumRepo: PremiumIntelligenceRepository;
    paymentRecordRepo: PaymentRecordRepository;
    subscriberRepo: EmailSubscriberRepository;
    execLogRepo: ExecutionLogRepository;
    x402Adapter: PaymentAdapter;
    settlementService: PaymentSettlementService;
    /** When set, referralAddress must resolve to an approved affiliate. */
    affiliateRepo?: AffiliateRepository | null;
    config: NewsletterSubscriptionConfig;
  }) {
    this.newsletterRepo = params.newsletterRepo;
    this.premiumRepo = params.premiumRepo;
    this.paymentRecordRepo = params.paymentRecordRepo;
    this.subscriberRepo = params.subscriberRepo;
    this.execLogRepo = params.execLogRepo;
    this.x402Adapter = params.x402Adapter;
    this.settlementService = params.settlementService;
    this.affiliateRepo = params.affiliateRepo ?? null;
    this.config = {
      monthlyPriceUsdc: params.config.monthlyPriceUsdc,
      billingPeriodDays: Math.max(
        1,
        params.config.billingPeriodDays || DEFAULT_NEWSLETTER_BILLING_PERIOD_DAYS,
      ),
      gracePeriodDays: Math.max(
        0,
        params.config.gracePeriodDays ?? DEFAULT_NEWSLETTER_GRACE_PERIOD_DAYS,
      ),
    };
  }

  /**
   * Ensure a referral wallet is an approved product affiliate (not an arbitrary 0x).
   */
  private async requireApprovedReferral(
    referralAddress: string | null,
  ): Promise<string | null> {
    if (!referralAddress) return null;
    if (!this.affiliateRepo) {
      // Without registry wiring, accept valid wallets (tests / legacy).
      return referralAddress;
    }
    const found = await this.affiliateRepo.findApprovedByWalletOrCode(referralAddress);
    if (!found.ok) {
      throw badRequest(found.error.message);
    }
    if (!found.value) {
      throw badRequest(
        "referralAddress must be an approved affiliate (register via POST /affiliates)",
      );
    }
    return found.value.wallet_address;
  }

  /**
   * Ensure the canonical monthly newsletter premium catalog item exists.
   * Used as payment_records.premium_item_id FK target.
   */
  async ensureNewsletterProduct(): Promise<PremiumIntelligenceItemRow> {
    const existing = await this.premiumRepo.findBySlug(MONTHLY_NEWSLETTER_SLUG);
    if (!existing.ok) {
      throw new Error(`Failed to load newsletter product: ${existing.error.message}`);
    }
    if (existing.value) {
      // Keep price/routes in sync with env config when product already exists.
      const needsUpdate =
        existing.value.price_amount !== this.config.monthlyPriceUsdc ||
        existing.value.price_currency !== "USDC" ||
        !existing.value.payment_routes.includes("x402") ||
        existing.value.status !== "available";

      if (!needsUpdate) {
        return existing.value;
      }

      const updated = await this.premiumRepo.update(existing.value.id, {
        price_amount: this.config.monthlyPriceUsdc,
        price_currency: "USDC",
        payment_routes: ["x402"],
        status: "available",
        content_type: "monthly_newsletter",
        title: "ChronicleAI Monthly Intelligence Newsletter",
        summary_public:
          "Recurring x402 monthly subscription for premium digests delivered by email.",
      });
      if (!updated.ok) {
        throw new Error(`Failed to update newsletter product: ${updated.error.message}`);
      }
      return updated.value;
    }

    const created = await this.premiumRepo.create({
      slug: MONTHLY_NEWSLETTER_SLUG,
      title: "ChronicleAI Monthly Intelligence Newsletter",
      content_type: "monthly_newsletter",
      summary_public:
        "Recurring x402 monthly subscription for premium digests delivered by email. " +
        `Billed every ${this.config.billingPeriodDays} days.`,
      content_private: {
        product: "monthly_newsletter",
        agreementType: "recurring_newsletter",
        billingPeriodDays: this.config.billingPeriodDays,
        gracePeriodDays: this.config.gracePeriodDays,
      },
      source_event_ids: [],
      price_amount: this.config.monthlyPriceUsdc,
      price_currency: "USDC",
      payment_routes: ["x402"],
      status: "available",
    });

    if (!created.ok) {
      throw new Error(`Failed to create newsletter product: ${created.error.message}`);
    }
    return created.value;
  }

  /**
   * Start or re-issue an x402 challenge for a new or lapsed newsletter subscription.
   */
  async startSubscribe(params: {
    email: string;
    payerReference?: string | undefined;
    referralAddress?: string | undefined;
  }): Promise<NewsletterChallengeResult> {
    const email = params.email.trim();
    if (!isValidSubscriberEmail(email)) {
      throw badRequest("Invalid email address");
    }

    const payerWallet = normalizeWalletAddress(params.payerReference);
    let referralAddress = normalizeWalletAddress(params.referralAddress);
    if (params.payerReference?.trim() && !payerWallet) {
      throw badRequest("payerReference must be a valid 0x EVM address when provided");
    }
    if (params.referralAddress?.trim() && !referralAddress) {
      throw badRequest("referralAddress must be a valid 0x EVM address when provided");
    }
    referralAddress = await this.requireApprovedReferral(referralAddress);

    const product = await this.ensureNewsletterProduct();
    const existingResult = await this.newsletterRepo.findByEmail(email);
    if (!existingResult.ok) {
      throw badRequest(existingResult.error.message);
    }

    let subscription = existingResult.value;

    // Already entitled — do not charge again until renewal is due.
    if (subscription && isNewsletterEntitled(subscription)) {
      throw badRequest(
        "Newsletter subscription is already active for this period. Use renew near period end.",
      );
    }

    if (!subscription) {
      const created = await this.newsletterRepo.create({
        email,
        email_normalized: normalizeSubscriberEmail(email),
        payer_wallet: payerWallet,
        referral_address: referralAddress,
        status: "pending",
        amount_per_period: this.config.monthlyPriceUsdc,
        currency: "USDC",
        billing_period_days: this.config.billingPeriodDays,
        grace_period_days: this.config.gracePeriodDays,
        premium_item_id: product.id,
        periods_paid: 0,
        cancel_at_period_end: false,
      });
      if (!created.ok) {
        throw badRequest(created.error.message);
      }
      subscription = created.value;
    } else {
      // Re-open expired/cancelled/past_due for a new initial period payment.
      const updated = await this.newsletterRepo.update(subscription.id, {
        status: "pending",
        amount_per_period: this.config.monthlyPriceUsdc,
        currency: "USDC",
        billing_period_days: this.config.billingPeriodDays,
        grace_period_days: this.config.gracePeriodDays,
        premium_item_id: product.id,
        cancel_at_period_end: false,
        cancelled_at: null,
        ...(payerWallet ? { payer_wallet: payerWallet } : {}),
        ...(referralAddress ? { referral_address: referralAddress } : {}),
      });
      if (!updated.ok) {
        throw badRequest(updated.error.message);
      }
      subscription = updated.value;
    }

    return this.issueChallenge({
      subscription,
      product,
      periodKind: "initial",
      payerReference: payerWallet ?? undefined,
      referralAddress: subscription.referral_address,
    });
  }

  /**
   * Issue a renewal challenge for an existing subscription whose period is ending or past due.
   */
  async startRenewal(params: {
    email?: string | undefined;
    payerWallet?: string | undefined;
  }): Promise<NewsletterChallengeResult> {
    const subscription = await this.resolveSubscription(params);
    if (!subscription) {
      throw badRequest("Newsletter subscription not found");
    }

    if (subscription.status === "cancelled" && !isNewsletterEntitled(subscription)) {
      throw badRequest("Subscription is cancelled. Start a new subscribe challenge instead.");
    }
    if (subscription.status === "expired") {
      throw badRequest("Subscription expired. Start a new subscribe challenge instead.");
    }

    const now = Date.now();
    const periodEndMs = subscription.current_period_end
      ? Date.parse(subscription.current_period_end)
      : 0;
    const renewWindowStart = periodEndMs - 7 * MS_PER_DAY;

    // Allow renewals in the final 7 days of the period, or anytime past due.
    if (
      subscription.status === "active" &&
      periodEndMs > 0 &&
      now < renewWindowStart
    ) {
      throw badRequest(
        "Renewal is available in the last 7 days of the current billing period.",
      );
    }

    const product = await this.ensureNewsletterProduct();
    return this.issueChallenge({
      subscription,
      product,
      periodKind: "renewal",
      payerReference: subscription.payer_wallet ?? undefined,
      referralAddress: subscription.referral_address,
    });
  }

  /**
   * Settle an x402 newsletter challenge and advance the billing period.
   */
  async settle(params: {
    challengeReference: string;
    settlementReference: string;
  }): Promise<NewsletterSettleResult> {
    const challengeReference = params.challengeReference.trim();
    const settlementReference = params.settlementReference.trim();
    if (!challengeReference) {
      throw badRequest("challengeReference is required");
    }
    if (!settlementReference) {
      throw badRequest("settlementReference is required");
    }

    const subResult =
      await this.newsletterRepo.findByPendingChallenge(challengeReference);
    if (!subResult.ok) {
      throw badRequest(subResult.error.message);
    }
    if (!subResult.value) {
      throw badRequest(
        "No newsletter subscription pending for this challenge. Start subscribe/renew first.",
      );
    }

    let subscription = subResult.value;

    const settleResult = await this.settlementService.settle({
      challengeReference,
      settlementReference,
      paymentRoute: "x402",
    });

    if (!settleResult.settled) {
      return {
        settled: false,
        subscription,
        paymentRecordId: settleResult.paymentRecordId,
        verification: {
          amountSettled: settleResult.verification.amountSettled,
          currency: settleResult.verification.currency,
          settlementReference: settleResult.verification.settlementReference,
          ...(settleResult.verification.payerReference
            ? { payerReference: settleResult.verification.payerReference }
            : {}),
          ...(settleResult.verification.errorMessage
            ? { errorMessage: settleResult.verification.errorMessage }
            : {}),
        },
      };
    }

    const payerFromSettlement = normalizeWalletAddress(
      settleResult.verification.payerReference,
    );
    const now = new Date();
    const period = this.computeNextPeriod(subscription, now);

    // Enroll email for digests (premium source)
    const emailSub = await this.subscriberRepo.subscribe({
      email: subscription.email,
      receivesDigests: true,
      receivesAlerts: true,
      source: "premium",
      payerReference: payerFromSettlement ?? subscription.payer_wallet,
    });
    if (!emailSub.ok) {
      throw badRequest(
        `Payment settled but email enrollment failed: ${emailSub.error.message}`,
      );
    }

    const activated = await this.newsletterRepo.update(subscription.id, {
      status: "active" as NewsletterSubscriptionStatus,
      current_period_start: period.start,
      current_period_end: period.end,
      next_renewal_at: period.end,
      periods_paid: subscription.periods_paid + 1,
      last_payment_record_id: settleResult.paymentRecordId,
      last_settlement_reference: settleResult.verification.settlementReference,
      last_settled_at: now.toISOString(),
      pending_challenge_reference: null,
      pending_payment_record_id: null,
      cancel_at_period_end: false,
      cancelled_at: null,
      email_subscriber_id: emailSub.value.subscriber.id,
      ...(payerFromSettlement ? { payer_wallet: payerFromSettlement } : {}),
    });

    if (!activated.ok) {
      throw badRequest(
        `Payment settled but failed to activate subscription: ${activated.error.message}`,
      );
    }
    subscription = activated.value;

    await this.execLogRepo.append({
      action_type: "payment",
      entity_type: "x402_newsletter_subscription",
      entity_id: subscription.id,
      status: "succeeded",
      message: "Recurring x402 newsletter period activated",
      details: {
        email: subscription.email,
        periodsPaid: subscription.periods_paid,
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: subscription.current_period_end,
        amountSettled: settleResult.verification.amountSettled,
        currency: settleResult.verification.currency,
        settlementReference: settleResult.verification.settlementReference,
        payerWallet: subscription.payer_wallet,
        paymentRecordId: settleResult.paymentRecordId,
      },
      started_at: now.toISOString(),
      completed_at: now.toISOString(),
    });

    return {
      settled: true,
      subscription,
      paymentRecordId: settleResult.paymentRecordId,
      verification: {
        amountSettled: settleResult.verification.amountSettled,
        currency: settleResult.verification.currency,
        settlementReference: settleResult.verification.settlementReference,
        ...(settleResult.verification.payerReference
          ? { payerReference: settleResult.verification.payerReference }
          : {}),
      },
    };
  }

  async getStatus(params: {
    email?: string | undefined;
    payerWallet?: string | undefined;
  }): Promise<NewsletterSubscriptionRow | null> {
    return this.resolveSubscription(params);
  }

  async cancel(params: {
    email?: string | undefined;
    payerWallet?: string | undefined;
    atPeriodEnd?: boolean | undefined;
  }): Promise<NewsletterSubscriptionRow> {
    const subscription = await this.resolveSubscription(params);
    if (!subscription) {
      throw badRequest("Newsletter subscription not found");
    }

    const atPeriodEnd = params.atPeriodEnd !== false;
    const now = new Date().toISOString();

    if (atPeriodEnd && isNewsletterEntitled(subscription)) {
      const updated = await this.newsletterRepo.update(subscription.id, {
        cancel_at_period_end: true,
        cancelled_at: now,
      });
      if (!updated.ok) {
        throw badRequest(updated.error.message);
      }
      return updated.value;
    }

    // Immediate cancel
    const updated = await this.newsletterRepo.update(subscription.id, {
      status: "cancelled",
      cancel_at_period_end: false,
      cancelled_at: now,
      next_renewal_at: null,
      pending_challenge_reference: null,
      pending_payment_record_id: null,
    });
    if (!updated.ok) {
      throw badRequest(updated.error.message);
    }

    // Stop digest delivery for this address when fully cancelled
    await this.subscriberRepo.unsubscribeByEmail(subscription.email);

    return updated.value;
  }

  /**
   * Transition active → past_due → expired when billing periods elapse without renewal.
   */
  async processBillingCycle(asOf?: Date): Promise<NewsletterBillingSweepResult> {
    const now = asOf ?? new Date();
    const nowIso = now.toISOString();
    const nowMs = now.getTime();

    const due = await this.newsletterRepo.listDueForBillingSweep(nowIso);
    if (!due.ok) {
      return {
        pastDue: 0,
        expired: 0,
        cancelledAtPeriodEnd: 0,
        errors: [due.error.message],
      };
    }

    let pastDue = 0;
    let expired = 0;
    let cancelledAtPeriodEnd = 0;
    const errors: string[] = [];

    for (const sub of due.value) {
      try {
        const periodEnd = sub.current_period_end
          ? Date.parse(sub.current_period_end)
          : Number.NaN;
        if (Number.isNaN(periodEnd) || nowMs <= periodEnd) {
          continue;
        }

        if (sub.cancel_at_period_end) {
          const updated = await this.newsletterRepo.update(sub.id, {
            status: "cancelled",
            cancel_at_period_end: false,
            next_renewal_at: null,
            pending_challenge_reference: null,
            pending_payment_record_id: null,
            cancelled_at: sub.cancelled_at ?? nowIso,
          });
          if (!updated.ok) {
            errors.push(`${sub.id}: ${updated.error.message}`);
            continue;
          }
          await this.subscriberRepo.unsubscribeByEmail(sub.email);
          cancelledAtPeriodEnd += 1;
          continue;
        }

        const graceEnd = periodEnd + Math.max(0, sub.grace_period_days) * MS_PER_DAY;

        if (nowMs <= graceEnd) {
          if (sub.status !== "past_due") {
            const updated = await this.newsletterRepo.update(sub.id, {
              status: "past_due",
            });
            if (!updated.ok) {
              errors.push(`${sub.id}: ${updated.error.message}`);
              continue;
            }
            pastDue += 1;
          }
          continue;
        }

        // Past grace — expire
        if (sub.status !== "expired") {
          const updated = await this.newsletterRepo.update(sub.id, {
            status: "expired",
            next_renewal_at: null,
            pending_challenge_reference: null,
            pending_payment_record_id: null,
          });
          if (!updated.ok) {
            errors.push(`${sub.id}: ${updated.error.message}`);
            continue;
          }
          // Revoke digest preference; user can re-subscribe via free or paid flow.
          await this.subscriberRepo.unsubscribeByEmail(sub.email);
          expired += 1;
        }
      } catch (err) {
        errors.push(
          `${sub.id}: ${err instanceof Error ? err.message : "billing sweep failed"}`,
        );
      }
    }

    return { pastDue, expired, cancelledAtPeriodEnd, errors };
  }

  /** Premium digest recipients with an active paid period (incl. grace). */
  async listPremiumDigestEmails(): Promise<string[]> {
    const result = await this.newsletterRepo.listEntitledEmails();
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    return result.value;
  }

  // ── Internals ─────────────────────────────────────────

  private async resolveSubscription(params: {
    email?: string | undefined;
    payerWallet?: string | undefined;
  }): Promise<NewsletterSubscriptionRow | null> {
    const email = params.email?.trim();
    const wallet = params.payerWallet?.trim();

    if (!email && !wallet) {
      throw badRequest("email or payerWallet is required");
    }

    if (email) {
      if (!isValidSubscriberEmail(email)) {
        throw badRequest("Invalid email address");
      }
      const result = await this.newsletterRepo.findByEmail(email);
      if (!result.ok) {
        throw badRequest(result.error.message);
      }
      return result.value;
    }

    const normalized = normalizeWalletAddress(wallet);
    if (!normalized) {
      throw badRequest("Invalid payer wallet address");
    }
    const result = await this.newsletterRepo.findByPayerWallet(normalized);
    if (!result.ok) {
      throw badRequest(result.error.message);
    }
    return result.value;
  }

  private async issueChallenge(params: {
    subscription: NewsletterSubscriptionRow;
    product: PremiumIntelligenceItemRow;
    periodKind: "initial" | "renewal";
    payerReference?: string | undefined;
    referralAddress?: string | null;
  }): Promise<NewsletterChallengeResult> {
    const challenge = await this.x402Adapter.createChallenge({
      premiumItemId: params.product.id,
      amount: this.config.monthlyPriceUsdc,
      currency: "USDC",
      payerReference: params.payerReference,
      agreement: {
        type: "recurring_newsletter",
        billingPeriodDays: this.config.billingPeriodDays,
        subscriptionId: params.subscription.id,
        periodKind: params.periodKind,
        referralAddress: params.referralAddress ?? null,
      },
    });

    const paymentRecord = await this.paymentRecordRepo.createChallenge({
      premium_item_id: params.product.id,
      payment_route: "x402",
      payer_reference: params.payerReference ?? null,
      // Affiliate from subscription intent — never the subscriber payer wallet.
      referral_address: params.referralAddress ?? null,
      amount_requested: this.config.monthlyPriceUsdc,
      currency: "USDC",
      status: "challenge_issued",
      challenge_reference: challenge.challengeReference,
      requested_at: new Date().toISOString(),
      expires_at: challenge.expiresAt,
    });

    if (!paymentRecord.ok) {
      throw badRequest(
        `Failed to create payment record: ${paymentRecord.error.message}`,
      );
    }

    const linked = await this.newsletterRepo.update(params.subscription.id, {
      pending_challenge_reference: challenge.challengeReference,
      pending_payment_record_id: paymentRecord.value.id,
      premium_item_id: params.product.id,
      amount_per_period: this.config.monthlyPriceUsdc,
      ...(params.payerReference ? { payer_wallet: params.payerReference } : {}),
    });

    if (!linked.ok) {
      throw badRequest(
        `Failed to link challenge to subscription: ${linked.error.message}`,
      );
    }

    await this.execLogRepo.append({
      action_type: "payment",
      entity_type: "x402_newsletter_subscription",
      entity_id: linked.value.id,
      status: "started",
      message: `x402 newsletter ${params.periodKind} challenge issued`,
      details: {
        challengeReference: challenge.challengeReference,
        periodKind: params.periodKind,
        amountRequested: challenge.amountRequested,
        currency: challenge.currency,
        email: linked.value.email,
        paymentRecordId: paymentRecord.value.id,
        billingPeriodDays: this.config.billingPeriodDays,
      },
    });

    return {
      subscription: linked.value,
      challenge,
      paymentRecordId: paymentRecord.value.id,
      periodKind: params.periodKind,
    };
  }

  /**
   * Next billing window: renewals stack from remaining period end when still entitled;
   * otherwise start from now.
   */
  private computeNextPeriod(
    subscription: NewsletterSubscriptionRow,
    now: Date,
  ): { start: string; end: string } {
    const days = subscription.billing_period_days || this.config.billingPeriodDays;
    const periodMs = days * MS_PER_DAY;

    let startMs = now.getTime();
    if (
      subscription.current_period_end &&
      isNewsletterEntitled(subscription, now.getTime())
    ) {
      const existingEnd = Date.parse(subscription.current_period_end);
      if (!Number.isNaN(existingEnd) && existingEnd > startMs) {
        startMs = existingEnd;
      }
    }

    const endMs = startMs + periodMs;
    // When stacking on remaining period, period start should be the previous end
    // only if we extended; for first activation start is now.
    const periodStart =
      subscription.current_period_end &&
      isNewsletterEntitled(subscription, now.getTime()) &&
      Date.parse(subscription.current_period_end) > now.getTime()
        ? subscription.current_period_end
        : now.toISOString();

    return {
      start: periodStart,
      end: new Date(endMs).toISOString(),
    };
  }
}

export function createNewsletterSubscriptionService(params: {
  newsletterRepo: NewsletterSubscriptionRepository;
  premiumRepo: PremiumIntelligenceRepository;
  paymentRecordRepo: PaymentRecordRepository;
  subscriberRepo: EmailSubscriberRepository;
  execLogRepo: ExecutionLogRepository;
  x402Adapter: PaymentAdapter;
  settlementService: PaymentSettlementService;
  affiliateRepo?: AffiliateRepository | null;
  config: NewsletterSubscriptionConfig;
}): NewsletterSubscriptionService {
  return new NewsletterSubscriptionService(params);
}
