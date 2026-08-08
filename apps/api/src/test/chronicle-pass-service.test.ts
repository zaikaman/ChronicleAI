// Tests for Chronicle Pass management: status derivation, cancel/resume,
// preference updates, wallet renewal/settlement, entitlement, and payments.

import type { NewsletterSubscriptionRow, PaymentRecordRow } from "@chronicleai/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChroniclePassService, derivePassStatus } from "../services/chronicle-pass-service.ts";
import type { NewsletterSubscriptionService } from "../services/newsletter-subscription-service.ts";

function baseSub(overrides: Partial<NewsletterSubscriptionRow> = {}): NewsletterSubscriptionRow {
  return {
    id: "sub-1",
    email: "reader@example.com",
    email_normalized: "reader@example.com",
    payer_wallet: "0xabc0000000000000000000000000000000000001",
    status: "active",
    amount_per_period: 4.99,
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
    last_settlement_reference: `0x${"11".repeat(32)}`,
    last_settled_at: new Date().toISOString(),
    pending_challenge_reference: null,
    pending_payment_record_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makePayment(overrides: Partial<PaymentRecordRow> = {}): PaymentRecordRow {
  return {
    id: "pay-1",
    premium_item_id: "premium-newsletter",
    payment_route: "x402",
    status: "settled",
    challenge_reference: "x402_1",
    payer_reference: "0xabc0000000000000000000000000000000000001",
    referral_address: null,
    amount_requested: 4.99,
    currency: "USDC",
    requested_at: new Date().toISOString(),
    expires_at: null,
    amount_settled: 4.99,
    settlement_reference: `0x${"22".repeat(32)}`,
    settled_at: new Date().toISOString(),
    registry_tx_hash: null,
    keeper_hub_run_id: null,
    explorer_url: null,
    content_uri: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

interface Mocks {
  newsletterRepo: {
    findByPayerWallet: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  paymentRecordRepo: { listByPayer: ReturnType<typeof vi.fn> };
  subscriberRepo: {
    findByEmail: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    unsubscribeByEmail: ReturnType<typeof vi.fn>;
  };
  newsletterService: {
    renewForWallet: ReturnType<typeof vi.fn>;
    settle: ReturnType<typeof vi.fn>;
    startSubscribe: ReturnType<typeof vi.fn>;
  };
}

function build(
  mocks: Mocks,
  sub: NewsletterSubscriptionRow | null = baseSub(),
): ChroniclePassService {
  // Stateful mock: repo.update mutates the row returned by findByPayerWallet so
  // the service's read-after-write status reflects the change (like the DB row).
  let currentSub = sub;
  mocks.newsletterRepo.findByPayerWallet.mockImplementation(async () => ({
    ok: true as const,
    value: currentSub,
  }));
  mocks.newsletterRepo.update.mockImplementation(
    async (id: string, updates: Record<string, unknown>) => {
      currentSub = baseSub({ id, ...updates } as Partial<NewsletterSubscriptionRow>);
      return { ok: true as const, value: currentSub };
    },
  );
  mocks.subscriberRepo.subscribe.mockResolvedValue({
    ok: true,
    value: { subscriber: { id: "email-1" }, reactivated: false, created: false },
  });
  mocks.subscriberRepo.unsubscribeByEmail.mockResolvedValue({ ok: true, value: null });
  mocks.subscriberRepo.findByEmail.mockResolvedValue({ ok: true, value: null });

  return new ChroniclePassService({
    newsletterService: mocks.newsletterService as unknown as NewsletterSubscriptionService,
    newsletterRepo: mocks.newsletterRepo as never,
    paymentRecordRepo: mocks.paymentRecordRepo as never,
    subscriberRepo: mocks.subscriberRepo as never,
    premiumRepo: { findBySlug: vi.fn() } as never,
    monthlyPriceUsdc: 4.99,
  });
}

function makeMocks(): Mocks {
  return {
    newsletterRepo: {
      findByPayerWallet: vi.fn(),
      update: vi.fn(),
    },
    paymentRecordRepo: { listByPayer: vi.fn() },
    subscriberRepo: {
      findByEmail: vi.fn(),
      subscribe: vi.fn(),
      unsubscribeByEmail: vi.fn(),
    },
    newsletterService: {
      renewForWallet: vi.fn(),
      settle: vi.fn(),
      startSubscribe: vi.fn(),
    },
  };
}

const WALLET = "0xabc0000000000000000000000000000000000001";

describe("derivePassStatus", () => {
  it("maps every stored state to the user-facing pass state", () => {
    expect(derivePassStatus(null)).toBe("none");
    expect(derivePassStatus(baseSub({ status: "pending" }))).toBe("pending");
    expect(derivePassStatus(baseSub({ status: "active" }))).toBe("active");
    expect(derivePassStatus(baseSub({ status: "active", cancel_at_period_end: true }))).toBe(
      "canceling",
    );
    expect(derivePassStatus(baseSub({ status: "past_due" }))).toBe("past_due");
    expect(derivePassStatus(baseSub({ status: "cancelled" }))).toBe("cancelled");
    expect(derivePassStatus(baseSub({ status: "expired" }))).toBe("expired");
  });
});

describe("ChroniclePassService", () => {
  let mocks: Mocks;

  beforeEach(() => {
    mocks = makeMocks();
  });

  it("returns full status for an active pass", async () => {
    const service = build(mocks);
    const status = await service.getStatusForWallet(WALLET);

    expect(status.passStatus).toBe("active");
    expect(status.entitled).toBe(true);
    expect(status.amountPerPeriod).toBe(4.99);
    expect(status.subscriptionId).toBe("sub-1");
    expect(status.cancelAtPeriodEnd).toBe(false);
  });

  it("reports no subscription for an unknown wallet", async () => {
    mocks.newsletterRepo.findByPayerWallet.mockResolvedValue({ ok: true, value: null });
    const service = build(mocks, null);
    const status = await service.getStatusForWallet(WALLET);

    expect(status.passStatus).toBe("none");
    expect(status.entitled).toBe(false);
    expect(status.amountPerPeriod).toBe(4.99);
  });

  it("resolves entitlement only while within the period window", async () => {
    const service = build(mocks);
    expect((await service.resolveEntitlement(WALLET)).entitled).toBe(true);

    mocks.newsletterRepo.findByPayerWallet.mockResolvedValue({
      ok: true,
      value: baseSub({
        status: "expired",
        current_period_end: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    });
    expect((await service.resolveEntitlement(WALLET)).entitled).toBe(false);
  });

  it("cancels at period end and resumes", async () => {
    const service = build(mocks);
    const cancelled = await service.cancelAtPeriodEnd(WALLET);
    expect(cancelled.cancelAtPeriodEnd).toBe(true);
    expect(cancelled.passStatus).toBe("canceling");
    expect(mocks.newsletterRepo.update).toHaveBeenCalledWith(
      "sub-1",
      expect.objectContaining({ cancel_at_period_end: true }),
    );

    const resumed = await service.resume(WALLET);
    expect(resumed.cancelAtPeriodEnd).toBe(false);
    expect(mocks.newsletterRepo.update).toHaveBeenLastCalledWith(
      "sub-1",
      expect.objectContaining({ cancel_at_period_end: false }),
    );
  });

  it("updates delivery email and re-links the subscriber", async () => {
    const service = build(mocks);
    const updated = await service.updatePreferences({
      wallet: WALLET,
      email: "new@example.com",
      receivesDigests: false,
      receivesAlerts: true,
    });

    expect(updated.email).toBe("new@example.com");
    expect(mocks.subscriberRepo.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "new@example.com",
        receivesDigests: false,
        receivesAlerts: true,
        source: "premium",
        payerReference: WALLET,
      }),
    );
    expect(mocks.subscriberRepo.unsubscribeByEmail).toHaveBeenCalledWith("reader@example.com");
  });

  it("delegates renewal to the newsletter service with the wallet", async () => {
    const service = build(mocks);
    mocks.newsletterService.renewForWallet.mockResolvedValue({ periodKind: "renewal" });
    const result = await service.renew(WALLET);
    expect(mocks.newsletterService.renewForWallet).toHaveBeenCalledWith({ wallet: WALLET });
    expect(result).toMatchObject({ periodKind: "renewal" });
  });

  it("only settles a challenge that belongs to the wallet subscription", async () => {
    const service = build(
      mocks,
      baseSub({ pending_challenge_reference: "x402_renew_1", pending_payment_record_id: "pay-2" }),
    );
    await expect(
      service.settle({
        wallet: WALLET,
        challengeReference: "some-other-challenge",
        settlementReference: "0xsettle",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    mocks.newsletterService.settle.mockResolvedValue({ settled: true });
    const ok = await service.settle({
      wallet: WALLET,
      challengeReference: "x402_renew_1",
      settlementReference: "0xsettle",
    });
    expect(mocks.newsletterService.settle).toHaveBeenCalledWith({
      challengeReference: "x402_renew_1",
      settlementReference: "0xsettle",
    });
    expect(ok.settled).toBe(true);
  });

  it("lists bounded, newest-first payment history", async () => {
    mocks.paymentRecordRepo.listByPayer.mockResolvedValue({
      ok: true,
      value: [makePayment()],
    });
    const service = build(mocks);
    const items = await service.listPayments(WALLET, 5);

    expect(mocks.paymentRecordRepo.listByPayer).toHaveBeenCalledWith(WALLET, 5);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      status: "settled",
      paymentRoute: "x402",
      amountSettled: 4.99,
      settlementReference: `0x${"22".repeat(32)}`,
    });
  });
});
