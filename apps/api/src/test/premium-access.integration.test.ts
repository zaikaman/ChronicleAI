// Integration tests for premium purchase access flow
// Tests the full payment challenge -> settlement -> content unlock cycle

import { beforeEach, describe, expect, it, vi } from "vitest";
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
    findByChallengeReference: vi.fn(),
    markSettled: vi.fn(),
    markUnderpaid: vi.fn(),
    markExpired: vi.fn(),
    markFailed: vi.fn(),
    listByPremiumItem: vi.fn(),
    list: vi.fn(),
    findSettledByPayer: vi.fn(),
  };

  const mockExecLogRepo = {
    append: vi.fn(),
    listByEntity: vi.fn(),
    listRecent: vi.fn(),
  };

  const accessService = new PremiumAccessService({
    premiumRepo: mockPremiumRepo as never,
    paymentRecordRepo: mockPaymentRecordRepo as never,
    execLogRepo: mockExecLogRepo as never,
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

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("Full premium access flow", () => {
    it("should block access and throw PaymentRequiredError for unpaid item", async () => {
      mockPremiumRepo.findById.mockResolvedValue({ ok: true, value: mockPremiumItem });
      mockPaymentRecordRepo.findSettledByPayer.mockResolvedValue({ ok: true, value: null });
      mockPaymentRecordRepo.listByPremiumItem.mockResolvedValue({ ok: true, value: [] });

      await expect(
        accessService.accessPremiumItem({
          itemId: "premium-deep-dive-001",
          payerReference: "0xnewuser",
        }),
      ).rejects.toThrow(PaymentRequiredError);
    });

    it("should grant access when settled payment exists for payer", async () => {
      mockPremiumRepo.findById.mockResolvedValue({ ok: true, value: mockPremiumItem });
      mockPaymentRecordRepo.findSettledByPayer.mockResolvedValue({
        ok: true,
        value: {
          id: "payment-settled-001",
          status: "settled",
          premium_item_id: "premium-deep-dive-001",
          payment_route: "x402",
          payer_reference: "0xpayinguser",
        },
      });

      const result = await accessService.accessPremiumItem({
        itemId: "premium-deep-dive-001",
        payerReference: "0xpayinguser",
      });

      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.content.contentPrivate).toEqual({ key: "secret data" });
        expect(result.content.title).toBe("Deep Dive: DeFi Liquidation Cascade Analysis");
      }
    });

    it("should return full content with private data after payment", async () => {
      mockPremiumRepo.findById.mockResolvedValue({ ok: true, value: mockPremiumItem });

      // Simulate a settled payment from any payer
      mockPaymentRecordRepo.listByPremiumItem.mockResolvedValue({
        ok: true,
        value: [
          {
            id: "payment-settled-001",
            status: "settled",
            premium_item_id: "premium-deep-dive-001",
            payment_route: "x402",
          },
        ],
      });

      const result = await accessService.accessPremiumItem({
        itemId: "premium-deep-dive-001",
      });

      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.content.contentPrivate).toEqual({ key: "secret data" });
        expect(result.content.sourceEventIds).toEqual(["event-001"]);
      }
    });

    it("should throw PaymentRequiredError for expired/underpaid records", async () => {
      mockPremiumRepo.findById.mockResolvedValue({ ok: true, value: mockPremiumItem });
      mockPaymentRecordRepo.findSettledByPayer.mockResolvedValue({ ok: true, value: null });
      mockPaymentRecordRepo.listByPremiumItem.mockResolvedValue({
        ok: true,
        value: [
          {
            id: "payment-underpaid-001",
            status: "underpaid",
            premium_item_id: "premium-deep-dive-001",
          },
          {
            id: "payment-expired-001",
            status: "expired",
            premium_item_id: "premium-deep-dive-001",
          },
        ],
      });

      await expect(
        accessService.accessPremiumItem({
          itemId: "premium-deep-dive-001",
          payerReference: "0xunderpaiduser",
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
