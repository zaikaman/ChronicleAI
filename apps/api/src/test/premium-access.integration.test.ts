// Integration tests for premium purchase access flow
// Tests settlement receipt -> content unlock (payer alone never unlocks)

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PremiumAccessReceiptService } from "../services/premium-access-receipt-service.ts";
import { PaymentRequiredError, PremiumAccessService } from "../services/premium-access-service.ts";

describe("Premium Access Integration", () => {
  const mockPremiumRepo = {
    listTeasers: vi.fn(),
    findBySlug: vi.fn(),
    findById: vi.fn(),
    findPrivateContent: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };

  const mockPaymentRecordRepo = {
    createChallenge: vi.fn(),
    findById: vi.fn(),
    findByChallengeReference: vi.fn(),
    markSettled: vi.fn(),
    markUnderpaid: vi.fn(),
    markExpired: vi.fn(),
    markFailed: vi.fn(),
    expireOpenChallenges: vi.fn().mockResolvedValue({ ok: true as const, value: 0 }),
    listByPremiumItem: vi.fn(),
    list: vi.fn(),
    findSettledByPayer: vi.fn(),
  };

  const mockExecLogRepo = {
    append: vi.fn(),
    listByEntity: vi.fn(),
    listRecent: vi.fn(),
  };

  const receiptService = new PremiumAccessReceiptService({
    secret: "test-premium-access-secret-key",
    ttlSeconds: 3600,
  });

  const accessService = new PremiumAccessService({
    premiumRepo: mockPremiumRepo as never,
    paymentRecordRepo: mockPaymentRecordRepo as never,
    execLogRepo: mockExecLogRepo as never,
    receiptService,
  });

  const mockPremiumItem = {
    id: "premium-deep-dive-001",
    slug: "deep-dive-001",
    title: "Deep Dive: DeFi Liquidation Cascade Analysis",
    content_type: "deep_dive" as const,
    summary_public: "In-depth analysis of recent liquidation cascades.",
    content_private: { key: "secret data" },
    source_event_ids: ["event-001"],
    price_amount: 5,
    price_currency: "USDC",
    payment_routes: ["x402", "mpp"],
    status: "available" as const,
    created_at: "2026-07-06T00:00:00.000Z",
    updated_at: "2026-07-06T00:00:00.000Z",
  };

  const settledPayment = {
    id: "payment-settled-001",
    status: "settled" as const,
    premium_item_id: "premium-deep-dive-001",
    payment_route: "x402" as const,
    payer_reference: "0xpayinguser",
    amount_requested: 5,
    amount_settled: 5,
    currency: "USDC",
    challenge_reference: "chal-001",
    settlement_reference: "settle-001",
    requested_at: "2026-07-06T00:00:00.000Z",
    settled_at: "2026-07-06T00:01:00.000Z",
    created_at: "2026-07-06T00:00:00.000Z",
    updated_at: "2026-07-06T00:01:00.000Z",
  };

  function issueValidReceipt(overrides?: {
    paymentRecordId?: string;
    premiumItemId?: string;
    payerReference?: string;
  }): string {
    return receiptService.issue({
      paymentRecordId: overrides?.paymentRecordId ?? settledPayment.id,
      premiumItemId: overrides?.premiumItemId ?? mockPremiumItem.id,
      payerReference: overrides?.payerReference ?? settledPayment.payer_reference,
    }).token;
  }

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("Full premium access flow", () => {
    it("should block access without an access receipt", async () => {
      mockPremiumRepo.findById.mockResolvedValue({ ok: true, value: mockPremiumItem });

      await expect(
        accessService.accessPremiumItem({
          itemId: "premium-deep-dive-001",
        }),
      ).rejects.toThrow(PaymentRequiredError);

      expect(mockPaymentRecordRepo.findById).not.toHaveBeenCalled();
      expect(mockPaymentRecordRepo.findSettledByPayer).not.toHaveBeenCalled();
      expect(mockPaymentRecordRepo.listByPremiumItem).not.toHaveBeenCalled();
    });

    it("should grant access with a valid receipt for a settled payment", async () => {
      mockPremiumRepo.findById.mockResolvedValue({ ok: true, value: mockPremiumItem });
      mockPaymentRecordRepo.findById.mockResolvedValue({ ok: true, value: settledPayment });

      const receipt = issueValidReceipt();
      const result = await accessService.accessPremiumItem({
        itemId: "premium-deep-dive-001",
        accessReceipt: receipt,
      });

      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.content.contentPrivate).toEqual({ key: "secret data" });
        expect(result.content.title).toBe("Deep Dive: DeFi Liquidation Cascade Analysis");
        expect(result.content.sourceEventIds).toEqual(["event-001"]);
      }
      expect(mockPaymentRecordRepo.findById).toHaveBeenCalledWith("payment-settled-001");
      expect(mockPaymentRecordRepo.listByPremiumItem).not.toHaveBeenCalled();
    });

    it("should deny access with a receipt for a different item", async () => {
      mockPremiumRepo.findById.mockResolvedValue({ ok: true, value: mockPremiumItem });

      const receipt = issueValidReceipt({ premiumItemId: "other-item-id" });

      await expect(
        accessService.accessPremiumItem({
          itemId: "premium-deep-dive-001",
          accessReceipt: receipt,
        }),
      ).rejects.toThrow(PaymentRequiredError);

      expect(mockPaymentRecordRepo.findById).not.toHaveBeenCalled();
    });

    it("should deny access when payment is no longer settled", async () => {
      mockPremiumRepo.findById.mockResolvedValue({ ok: true, value: mockPremiumItem });
      mockPaymentRecordRepo.findById.mockResolvedValue({
        ok: true,
        value: { ...settledPayment, status: "failed" },
      });

      const receipt = issueValidReceipt();

      await expect(
        accessService.accessPremiumItem({
          itemId: "premium-deep-dive-001",
          accessReceipt: receipt,
        }),
      ).rejects.toThrow(PaymentRequiredError);
    });

    it("should deny access with a forged receipt signature", async () => {
      mockPremiumRepo.findById.mockResolvedValue({ ok: true, value: mockPremiumItem });
      mockPaymentRecordRepo.findById.mockResolvedValue({ ok: true, value: settledPayment });

      const forged = new PremiumAccessReceiptService({
        secret: "attacker-secret-key!!",
        ttlSeconds: 3600,
      }).issue({
        paymentRecordId: settledPayment.id,
        premiumItemId: mockPremiumItem.id,
        payerReference: "0xattacker",
      }).token;

      await expect(
        accessService.accessPremiumItem({
          itemId: "premium-deep-dive-001",
          accessReceipt: forged,
        }),
      ).rejects.toThrow(PaymentRequiredError);

      expect(mockPaymentRecordRepo.findById).not.toHaveBeenCalled();
    });

    it("should deny access when receipt payment id does not exist", async () => {
      mockPremiumRepo.findById.mockResolvedValue({ ok: true, value: mockPremiumItem });
      mockPaymentRecordRepo.findById.mockResolvedValue({ ok: true, value: null });

      const receipt = issueValidReceipt({ paymentRecordId: "missing-payment" });

      await expect(
        accessService.accessPremiumItem({
          itemId: "premium-deep-dive-001",
          accessReceipt: receipt,
        }),
      ).rejects.toThrow(PaymentRequiredError);
    });
  });

  describe("Premium item listing", () => {
    it("should return only available items as teasers", async () => {
      mockPremiumRepo.listTeasers.mockResolvedValue({
        ok: true,
        value: [mockPremiumItem],
      });

      const teasers = await accessService.listTeasers();

      expect(teasers).toHaveLength(1);
      expect(teasers[0]?.title).toBe("Deep Dive: DeFi Liquidation Cascade Analysis");
      expect(teasers[0]).not.toHaveProperty("contentPrivate");
    });

    it("should handle empty list gracefully", async () => {
      mockPremiumRepo.listTeasers.mockResolvedValue({
        ok: true,
        value: [],
      });

      const teasers = await accessService.listTeasers();

      expect(teasers).toHaveLength(0);
    });
  });
});
