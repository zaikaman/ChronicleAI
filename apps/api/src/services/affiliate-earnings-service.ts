// Credits affiliate USDC rewards when a referred wallet settles a payment.
// Auto revenue-routing no longer pays affiliates; they withdraw via the agent.

import type {
  AffiliateEarningRepository,
  AffiliateRepository,
  PaymentRecordRow,
  ReferralAttributionRepository,
} from "@chronicleai/db";
import { normalizeAffiliateWallet } from "@chronicleai/db";

export interface AffiliateEarningsConfig {
  /** Fraction of settled amount credited to the affiliate (0–1). */
  referralRewardShare: number;
  /** Absolute max USDC credit per single payment. */
  referralRewardCapPerPayment: number;
}

export interface CreditFromSettlementResult {
  credited: boolean;
  rewardAmount: number;
  reason?: string;
  earningId?: string;
}

export interface AffiliateEarningsService {
  /**
   * Resolve the affiliate wallet for a payer (attribution table, then payment.referral_address).
   */
  resolveAffiliateForPayer(
    payerWallet: string | null | undefined,
    paymentReferralAddress?: string | null,
  ): Promise<string | null>;

  /**
   * After a successful settlement, credit the affiliate if the payer is attributed.
   * Idempotent per payment_record_id.
   */
  creditFromSettledPayment(payment: PaymentRecordRow): Promise<CreditFromSettlementResult>;
}

function roundUsdc(amount: number): number {
  // Match typical stablecoin display precision (6 decimals), store as number.
  return Math.round(amount * 1_000_000) / 1_000_000;
}

export function createAffiliateEarningsService(
  deps: {
    attributionRepo: ReferralAttributionRepository;
    earningRepo: AffiliateEarningRepository;
    affiliateRepo: AffiliateRepository;
  },
  config: AffiliateEarningsConfig,
): AffiliateEarningsService {
  const share = config.referralRewardShare;
  const cap = config.referralRewardCapPerPayment;

  return {
    async resolveAffiliateForPayer(payerWallet, paymentReferralAddress) {
      const payer = normalizeAffiliateWallet(payerWallet ?? null);
      if (payer) {
        const attr = await deps.attributionRepo.findByReferredWallet(payer);
        if (attr.ok && attr.value) {
          return attr.value.affiliate_wallet;
        }
      }

      const fromPayment = normalizeAffiliateWallet(paymentReferralAddress ?? null);
      if (!fromPayment) return null;

      const approved = await deps.affiliateRepo.findApprovedByWalletOrCode(fromPayment);
      if (!approved.ok || !approved.value) return null;
      return approved.value.wallet_address;
    },

    async creditFromSettledPayment(payment) {
      if (payment.status !== "settled") {
        return { credited: false, rewardAmount: 0, reason: "payment_not_settled" };
      }

      const existing = await deps.earningRepo.findByPaymentRecordId(payment.id);
      if (!existing.ok) {
        return { credited: false, rewardAmount: 0, reason: existing.error.message };
      }
      if (existing.value) {
        return {
          credited: true,
          rewardAmount: existing.value.reward_amount,
          earningId: existing.value.id,
          reason: "already_credited",
        };
      }

      const payer = normalizeAffiliateWallet(payment.payer_reference);
      if (!payer) {
        return { credited: false, rewardAmount: 0, reason: "no_payer_wallet" };
      }

      const affiliateWallet = await this.resolveAffiliateForPayer(
        payer,
        payment.referral_address,
      );
      if (!affiliateWallet) {
        return { credited: false, rewardAmount: 0, reason: "no_affiliate_attribution" };
      }

      if (affiliateWallet === payer) {
        return { credited: false, rewardAmount: 0, reason: "self_referral_blocked" };
      }

      const approved = await deps.affiliateRepo.findByWallet(affiliateWallet);
      if (!approved.ok || !approved.value || approved.value.status !== "approved") {
        return { credited: false, rewardAmount: 0, reason: "affiliate_not_approved" };
      }

      const settled = Number(payment.amount_settled ?? 0);
      if (!(settled > 0) || !Number.isFinite(settled)) {
        return { credited: false, rewardAmount: 0, reason: "zero_settled_amount" };
      }

      const rawReward = settled * share;
      const rewardAmount = roundUsdc(Math.min(rawReward, cap));
      if (!(rewardAmount > 0)) {
        return { credited: false, rewardAmount: 0, reason: "reward_rounded_to_zero" };
      }

      const credit = await deps.earningRepo.credit({
        affiliate_wallet: affiliateWallet,
        referred_wallet: payer,
        payment_record_id: payment.id,
        payment_amount: settled,
        reward_share: share,
        reward_amount: rewardAmount,
        currency: payment.currency ?? "USDC",
      });

      if (!credit.ok) {
        return { credited: false, rewardAmount: 0, reason: credit.error.message };
      }

      return {
        credited: true,
        rewardAmount: credit.value.reward_amount,
        earningId: credit.value.id,
      };
    },
  };
}
