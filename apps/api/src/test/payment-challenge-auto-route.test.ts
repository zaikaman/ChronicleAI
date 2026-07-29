import { describe, expect, it, beforeEach } from "vitest";
import type { PaymentRecordRepository, PremiumIntelligenceItemRow } from "@chronicleai/db";
import type { PaymentRoute } from "@chronicleai/schemas";
import { PaymentChallengeService } from "../services/payment-challenge-service.ts";
import type { PaymentAdapter, ChallengeResult } from "../payments/payment-adapter.ts";

function createMockAdapter(route: PaymentRoute): PaymentAdapter {
  return {
    route,
    createChallenge: async (params) => ({
      challengeReference: `${route}_ref_123`,
      paymentRoute: route,
      amountRequested: params.amount,
      currency: params.currency,
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      challengeData: {},
    }),
    verifySettlement: async () => ({
      verified: true,
      amountSettled: 10,
      currency: "USDC",
      settlementReference: "settle_123",
    }),
  };
}

function createMockRecordRepo(): PaymentRecordRepository {
  return {
    createChallenge: async (record: Record<string, unknown>) => ({
      ok: true,
      value: {
        id: "rec_123",
        ...record,
        completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any,
    }),
    findByChallengeReference: async () => ({ ok: true, value: null }),
    updateStatus: async () => ({ ok: true, value: null as any }),
  } as unknown as PaymentRecordRepository;
}

const mockItem: PremiumIntelligenceItemRow = {
  id: "item_123",
  title: "Test Feed Item",
  slug: "test-feed-item",
  summary_public: "Teaser summary",
  content_type: "historical_feed",
  content_private: {},
  source_event_ids: [],
  status: "available",
  price_amount: 5,
  price_currency: "USDC",
  payment_routes: ["x402", "mpp"],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe("PaymentChallengeService Auto Route Selection", () => {
  let service: PaymentChallengeService;

  beforeEach(() => {
    const adapters = new Map<PaymentRoute, PaymentAdapter>([
      ["x402", createMockAdapter("x402")],
      ["mpp", createMockAdapter("mpp")],
    ]);

    service = new PaymentChallengeService({
      paymentRecordRepo: createMockRecordRepo(),
      adapters,
    });
  });

  it("should select explicit x402 route", () => {
    const resolved = service.resolveAutoRoute({ paymentRoute: "x402" });
    expect(resolved).toEqual({ paymentRoute: "x402", reason: "explicit_x402" });
  });

  it("should select explicit mpp route", () => {
    const resolved = service.resolveAutoRoute({ paymentRoute: "mpp" });
    expect(resolved).toEqual({ paymentRoute: "mpp", reason: "explicit_mpp" });
  });

  it("should auto-select mpp when X-Chronicle-Client: agent header is provided", () => {
    const resolved = service.resolveAutoRoute({
      paymentRoute: "auto",
      chronicleClientHeader: "agent",
    });
    expect(resolved).toEqual({ paymentRoute: "mpp", reason: "auto_selected_mpp" });
  });

  it("should auto-select mpp when clientType: machine is provided", () => {
    const resolved = service.resolveAutoRoute({
      paymentRoute: "auto",
      clientType: "machine",
    });
    expect(resolved).toEqual({ paymentRoute: "mpp", reason: "auto_selected_mpp" });
  });

  it("should auto-select mpp when payerReference starts with mpp-", () => {
    const resolved = service.resolveAutoRoute({
      paymentRoute: "auto",
      payerReference: "mpp-client-789",
    });
    expect(resolved).toEqual({ paymentRoute: "mpp", reason: "auto_selected_mpp" });
  });

  it("should default to x402 for standard browser/EVM client references", () => {
    const resolved = service.resolveAutoRoute({
      paymentRoute: "auto",
      payerReference: "0x1234567890123456789012345678901234567890",
    });
    expect(resolved).toEqual({ paymentRoute: "x402", reason: "auto_selected_x402" });
  });

  it("should issue challenge successfully when paymentRoute is omitted (defaults to auto)", async () => {
    const res = await service.createChallenge({
      premiumItem: mockItem,
      chronicleClientHeader: "agent",
    });

    expect(res.autoSelectReason).toBe("auto_selected_mpp");
    expect(res.challenge.paymentRoute).toBe("mpp");
  });
});
