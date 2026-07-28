// Unit tests for recurring x402 newsletter subscription service

import { describe, expect, it, vi, beforeEach } from "vitest";
import { isNewsletterEntitled } from "@chronicleai/db";
import type { NewsletterSubscriptionRow } from "@chronicleai/db";
import {
  NewsletterSubscriptionService,
  toNewsletterSubscriptionResponse,
} from "../services/newsletter-subscription-service.ts";
import type { PaymentAdapter } from "../payments/payment-adapter.ts";
import { PaymentSettlementService } from "../services/payment-settlement-service.ts";

function baseSub(
  overrides: Partial<NewsletterSubscriptionRow> = {},
): NewsletterSubscriptionRow {
  return {
    id: "sub-1",
    email: "reader@example.com",
    email_normalized: "reader@example.com",
    payer_wallet: "0xabc0000000000000000000000000000000000001",
    status: "active",
    amount_per_period: 2,
    currency: "USDC",
    billing_period_days: 30,
    current_period_start: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    current_period_end: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString(),
    next_renewal_at: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString(),
    periods_paid: 1,
    grace_period_days: 3,
    referral_address: null,
    cancel_at_period_end: false,
    cancelled_at: null,
    premium_item_id: "premium-newsletter",
    email_subscriber_id: "email-1",
    last_payment_record_id: "pay-1",
    last_settlement_reference: "0x" + "11".repeat(32),
    last_settled_at: new Date().toISOString(),
    pending_challenge_reference: null,
    pending_payment_record_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("isNewsletterEntitled", () => {
  it("entitles active subscriptions within current period", () => {
    expect(isNewsletterEntitled(baseSub())).toBe(true);
  });

  it("entitles past_due within grace", () => {
    const periodEnd = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    expect(
      isNewsletterEntitled(
        baseSub({
          status: "past_due",
          current_period_end: periodEnd,
          grace_period_days: 3,
        }),
      ),
    ).toBe(true);
  });

  it("denies past grace window", () => {
    const periodEnd = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(
      isNewsletterEntitled(
        baseSub({
          status: "past_due",
          current_period_end: periodEnd,
          grace_period_days: 3,
        }),
      ),
    ).toBe(false);
  });

  it("denies cancel_at_period_end after period end", () => {
    const periodEnd = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    expect(
      isNewsletterEntitled(
        baseSub({
          status: "active",
          cancel_at_period_end: true,
          current_period_end: periodEnd,
          grace_period_days: 3,
        }),
      ),
    ).toBe(false);
  });
});

describe("toNewsletterSubscriptionResponse", () => {
  it("maps snake_case row to API shape with entitled flag", () => {
    const response = toNewsletterSubscriptionResponse(baseSub());
    expect(response.email).toBe("reader@example.com");
    expect(response.amountPerPeriod).toBe(2);
    expect(response.entitled).toBe(true);
    expect(response.billingPeriodDays).toBe(30);
  });
});

describe("NewsletterSubscriptionService", () => {
  const product = {
    id: "premium-newsletter",
    slug: "monthly-newsletter-x402",
    title: "ChronicleAI Monthly Intelligence Newsletter",
    content_type: "monthly_newsletter" as const,
    summary_public: "Premium digests",
    content_private: {},
    source_event_ids: [] as string[],
    price_amount: 2,
    price_currency: "USDC",
    payment_routes: ["x402"],
    status: "available" as const,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  let newsletterRepo: {
    findByEmail: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    findByPayerWallet: ReturnType<typeof vi.fn>;
    findByPendingChallenge: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    listEntitledEmails: ReturnType<typeof vi.fn>;
    listDueForBillingSweep: ReturnType<typeof vi.fn>;
  };
  let premiumRepo: {
    findBySlug: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let paymentRecordRepo: {
    createChallenge: ReturnType<typeof vi.fn>;
    expireOpenChallenges: ReturnType<typeof vi.fn>;
    findByChallengeReference: ReturnType<typeof vi.fn>;
    markSettled: ReturnType<typeof vi.fn>;
    markExpired: ReturnType<typeof vi.fn>;
    markUnderpaid: ReturnType<typeof vi.fn>;
    markFailed: ReturnType<typeof vi.fn>;
    markRegistryProof: ReturnType<typeof vi.fn>;
  };
  let subscriberRepo: {
    subscribe: ReturnType<typeof vi.fn>;
    unsubscribeByEmail: ReturnType<typeof vi.fn>;
  };
  let execLogRepo: { append: ReturnType<typeof vi.fn> };
  let x402Adapter: PaymentAdapter;

  beforeEach(() => {
    newsletterRepo = {
      findByEmail: vi.fn(),
      findById: vi.fn(),
      findByPayerWallet: vi.fn(),
      findByPendingChallenge: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      listEntitledEmails: vi.fn(),
      listDueForBillingSweep: vi.fn(),
    };
    premiumRepo = {
      findBySlug: vi.fn().mockResolvedValue({ ok: true, value: product }),
      create: vi.fn(),
      update: vi.fn(),
    };
    paymentRecordRepo = {
      createChallenge: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          id: "pay-new",
          challenge_reference: "x402_challenge_1",
          status: "challenge_issued",
        },
      }),
      expireOpenChallenges: vi.fn().mockResolvedValue({ ok: true, value: 0 }),
      findByChallengeReference: vi.fn(),
      markSettled: vi.fn(),
      markExpired: vi.fn(),
      markUnderpaid: vi.fn(),
      markFailed: vi.fn(),
      markRegistryProof: vi.fn(),
    };
    subscriberRepo = {
      subscribe: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          subscriber: { id: "email-1", email: "reader@example.com" },
          created: true,
          reactivated: false,
        },
      }),
      unsubscribeByEmail: vi.fn().mockResolvedValue({ ok: true, value: null }),
    };
    execLogRepo = { append: vi.fn().mockResolvedValue({ ok: true, value: {} }) };

    x402Adapter = {
      route: "x402",
      createChallenge: vi.fn().mockResolvedValue({
        challengeReference: "x402_challenge_1",
        paymentRoute: "x402",
        amountRequested: 2,
        currency: "USDC",
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        challengeData: {
          agreementType: "recurring_newsletter",
          billingPeriodDays: 30,
          periodKind: "initial",
        },
      }),
      verifySettlement: vi.fn(),
    };
  });

  function buildService() {
    const settlementService = new PaymentSettlementService({
      paymentRecordRepo: paymentRecordRepo as never,
      execLogRepo: execLogRepo as never,
      adapters: new Map([["x402", x402Adapter]]),
    });

    return new NewsletterSubscriptionService({
      newsletterRepo: newsletterRepo as never,
      premiumRepo: premiumRepo as never,
      paymentRecordRepo: paymentRecordRepo as never,
      subscriberRepo: subscriberRepo as never,
      execLogRepo: execLogRepo as never,
      x402Adapter,
      settlementService,
      config: {
        monthlyPriceUsdc: 2,
        billingPeriodDays: 30,
        gracePeriodDays: 3,
      },
    });
  }

  it("issues an initial x402 challenge for a new subscriber", async () => {
    newsletterRepo.findByEmail.mockResolvedValue({ ok: true, value: null });
    const pending = baseSub({
      status: "pending",
      periods_paid: 0,
      current_period_start: null,
      current_period_end: null,
      next_renewal_at: null,
      last_payment_record_id: null,
      last_settlement_reference: null,
      last_settled_at: null,
    });
    newsletterRepo.create.mockResolvedValue({ ok: true, value: pending });
    newsletterRepo.update.mockResolvedValue({
      ok: true,
      value: {
        ...pending,
        pending_challenge_reference: "x402_challenge_1",
        pending_payment_record_id: "pay-new",
      },
    });

    const service = buildService();
    const result = await service.startSubscribe({
      email: "reader@example.com",
      payerReference: "0xABC0000000000000000000000000000000000001",
      referralAddress: "0xdef0000000000000000000000000000000000002",
    });

    expect(result.periodKind).toBe("initial");
    expect(result.challenge.challengeReference).toBe("x402_challenge_1");
    expect(result.paymentRecordId).toBe("pay-new");
    expect(x402Adapter.createChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2,
        currency: "USDC",
        agreement: expect.objectContaining({
          type: "recurring_newsletter",
          periodKind: "initial",
          billingPeriodDays: 30,
        }),
      }),
    );
  });

  it("rejects subscribe when already entitled", async () => {
    newsletterRepo.findByEmail.mockResolvedValue({
      ok: true,
      value: baseSub({ status: "active" }),
    });

    const service = buildService();
    await expect(
      service.startSubscribe({ email: "reader@example.com" }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("settles a challenge and activates a billing period", async () => {
    const pending = baseSub({
      status: "pending",
      periods_paid: 0,
      current_period_start: null,
      current_period_end: null,
      pending_challenge_reference: "x402_challenge_1",
      pending_payment_record_id: "pay-new",
      last_payment_record_id: null,
      last_settlement_reference: null,
      last_settled_at: null,
    });

    newsletterRepo.findByPendingChallenge.mockResolvedValue({
      ok: true,
      value: pending,
    });

    paymentRecordRepo.findByChallengeReference.mockResolvedValue({
      ok: true,
      value: {
        id: "pay-new",
        premium_item_id: product.id,
        payment_route: "x402",
        status: "challenge_issued",
        amount_requested: 2,
        currency: "USDC",
        challenge_reference: "x402_challenge_1",
        requested_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        payer_reference: "0xabc0000000000000000000000000000000000001",
        amount_settled: null,
        settlement_reference: null,
        settled_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });

    x402Adapter.verifySettlement = vi.fn().mockResolvedValue({
      verified: true,
      amountSettled: 2,
      currency: "USDC",
      settlementReference: "0x" + "22".repeat(32),
      payerReference: "0xabc0000000000000000000000000000000000001",
    });

    paymentRecordRepo.markSettled.mockResolvedValue({
      ok: true,
      value: {
        id: "pay-new",
        status: "settled",
        payer_reference: "0xabc0000000000000000000000000000000000001",
        amount_settled: 2,
        currency: "USDC",
        settlement_reference: "0x" + "22".repeat(32),
      },
    });

    const activated = baseSub({
      status: "active",
      periods_paid: 1,
      pending_challenge_reference: null,
      pending_payment_record_id: null,
    });
    newsletterRepo.update.mockResolvedValue({ ok: true, value: activated });

    const service = buildService();
    const result = await service.settle({
      challengeReference: "x402_challenge_1",
      settlementReference: "0x" + "22".repeat(32),
    });

    expect(result.settled).toBe(true);
    expect(result.subscription.status).toBe("active");
    expect(result.subscription.periods_paid).toBe(1);
    expect(subscriberRepo.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "reader@example.com",
        source: "premium",
        receivesDigests: true,
      }),
    );
  });

  it("marks past_due then expired in billing sweep", async () => {
    const pastPeriod = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    const graceExpired = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

    newsletterRepo.listDueForBillingSweep.mockResolvedValue({
      ok: true,
      value: [
        baseSub({
          id: "sub-past-due",
          status: "active",
          current_period_end: pastPeriod,
          grace_period_days: 3,
        }),
        baseSub({
          id: "sub-expired",
          status: "past_due",
          current_period_end: graceExpired,
          grace_period_days: 3,
        }),
      ],
    });

    newsletterRepo.update.mockImplementation(async (id: string, updates: Record<string, unknown>) => ({
      ok: true as const,
      value: baseSub({ id, ...updates } as Partial<NewsletterSubscriptionRow>),
    }));

    const service = buildService();
    const result = await service.processBillingCycle();

    expect(result.pastDue).toBe(1);
    expect(result.expired).toBe(1);
    expect(subscriberRepo.unsubscribeByEmail).toHaveBeenCalled();
  });
});
