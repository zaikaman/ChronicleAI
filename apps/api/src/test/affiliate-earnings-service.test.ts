import { describe, expect, it, vi } from "vitest";
import { createAffiliateEarningsService } from "../services/affiliate-earnings-service.ts";
import type { PaymentRecordRow } from "@chronicleai/db";

const AFFILIATE = "0x1111111111111111111111111111111111111111";
const PAYER = "0x2222222222222222222222222222222222222222";

function settledPayment(overrides?: Partial<PaymentRecordRow>): PaymentRecordRow {
  return {
    id: "pay-1",
    premium_item_id: "item-1",
    payment_route: "x402",
    payer_reference: PAYER,
    referral_address: AFFILIATE,
    amount_requested: 10,
    amount_settled: 10,
    currency: "USDC",
    status: "settled",
    challenge_reference: "ch-1",
    settlement_reference: "0xsettle",
    requested_at: new Date().toISOString(),
    expires_at: null,
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

describe("createAffiliateEarningsService", () => {
  it("credits share of settled payment from first-touch attribution", async () => {
    const credit = vi.fn().mockResolvedValue({
      ok: true as const,
      value: {
        id: "earn-1",
        affiliate_wallet: AFFILIATE,
        referred_wallet: PAYER,
        payment_record_id: "pay-1",
        payment_amount: 10,
        reward_share: 0.2,
        reward_amount: 2,
        currency: "USDC",
        created_at: new Date().toISOString(),
      },
    });

    const service = createAffiliateEarningsService(
      {
        attributionRepo: {
          findByReferredWallet: vi.fn().mockResolvedValue({
            ok: true as const,
            value: {
              id: "attr-1",
              referred_wallet: PAYER,
              affiliate_wallet: AFFILIATE,
              referral_code: "demo",
              source: "web_connect",
              attributed_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          }),
          listByAffiliate: vi.fn(),
          countByAffiliate: vi.fn(),
          attributeFirstTouch: vi.fn(),
        },
        earningRepo: {
          credit,
          findByPaymentRecordId: vi.fn().mockResolvedValue({ ok: true as const, value: null }),
          listByAffiliate: vi.fn(),
          sumEarnedByAffiliate: vi.fn(),
        },
        affiliateRepo: {
          findByWallet: vi.fn().mockResolvedValue({
            ok: true as const,
            value: {
              id: "aff-1",
              wallet_address: AFFILIATE,
              display_name: "Demo",
              referral_code: "demo",
              status: "approved",
              metadata: {},
              approved_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          }),
          findById: vi.fn(),
          findByReferralCode: vi.fn(),
          findApprovedByWalletOrCode: vi.fn(),
          listApprovedWallets: vi.fn(),
          listApproved: vi.fn(),
          listApprovedPage: vi.fn(),
          register: vi.fn(),
          update: vi.fn(),
          setStatus: vi.fn(),
        },
      },
      { referralRewardShare: 0.2, referralRewardCapPerPayment: 1000 },
    );

    const result = await service.creditFromSettledPayment(settledPayment());
    expect(result.credited).toBe(true);
    expect(result.rewardAmount).toBe(2);
    expect(credit).toHaveBeenCalledWith(
      expect.objectContaining({
        affiliate_wallet: AFFILIATE,
        referred_wallet: PAYER,
        reward_amount: 2,
      }),
    );
  });

  it("is idempotent when earning already exists", async () => {
    const service = createAffiliateEarningsService(
      {
        attributionRepo: {
          findByReferredWallet: vi.fn(),
          listByAffiliate: vi.fn(),
          countByAffiliate: vi.fn(),
          attributeFirstTouch: vi.fn(),
        },
        earningRepo: {
          credit: vi.fn(),
          findByPaymentRecordId: vi.fn().mockResolvedValue({
            ok: true as const,
            value: {
              id: "earn-1",
              affiliate_wallet: AFFILIATE,
              referred_wallet: PAYER,
              payment_record_id: "pay-1",
              payment_amount: 10,
              reward_share: 0.2,
              reward_amount: 2,
              currency: "USDC",
              created_at: new Date().toISOString(),
            },
          }),
          listByAffiliate: vi.fn(),
          sumEarnedByAffiliate: vi.fn(),
        },
        affiliateRepo: {
          findByWallet: vi.fn(),
          findById: vi.fn(),
          findByReferralCode: vi.fn(),
          findApprovedByWalletOrCode: vi.fn(),
          listApprovedWallets: vi.fn(),
          listApproved: vi.fn(),
          listApprovedPage: vi.fn(),
          register: vi.fn(),
          update: vi.fn(),
          setStatus: vi.fn(),
        },
      },
      { referralRewardShare: 0.2, referralRewardCapPerPayment: 1000 },
    );

    const result = await service.creditFromSettledPayment(settledPayment());
    expect(result.credited).toBe(true);
    expect(result.reason).toBe("already_credited");
  });

  it("skips when no attribution", async () => {
    const service = createAffiliateEarningsService(
      {
        attributionRepo: {
          findByReferredWallet: vi.fn().mockResolvedValue({ ok: true as const, value: null }),
          listByAffiliate: vi.fn(),
          countByAffiliate: vi.fn(),
          attributeFirstTouch: vi.fn(),
        },
        earningRepo: {
          credit: vi.fn(),
          findByPaymentRecordId: vi.fn().mockResolvedValue({ ok: true as const, value: null }),
          listByAffiliate: vi.fn(),
          sumEarnedByAffiliate: vi.fn(),
        },
        affiliateRepo: {
          findByWallet: vi.fn(),
          findById: vi.fn(),
          findByReferralCode: vi.fn(),
          findApprovedByWalletOrCode: vi.fn().mockResolvedValue({ ok: true as const, value: null }),
          listApprovedWallets: vi.fn(),
          listApproved: vi.fn(),
          listApprovedPage: vi.fn(),
          register: vi.fn(),
          update: vi.fn(),
          setStatus: vi.fn(),
        },
      },
      { referralRewardShare: 0.2, referralRewardCapPerPayment: 1000 },
    );

    const result = await service.creditFromSettledPayment(
      settledPayment({ referral_address: null }),
    );
    expect(result.credited).toBe(false);
    expect(result.reason).toBe("no_affiliate_attribution");
  });
});
