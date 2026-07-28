// Aggregates affiliate dashboard stats: referrals, earnings, available balance, withdrawals.

import type {
  AffiliateEarningRepository,
  AffiliateRepository,
  AffiliateRow,
  AffiliateWithdrawalRepository,
  ReferralAttributionRepository,
} from "@chronicleai/db";
import { normalizeAffiliateWallet } from "@chronicleai/db";

export interface AffiliateDashboardStats {
  affiliate: {
    walletAddress: string;
    displayName: string | null;
    referralCode: string | null;
    status: string;
    referralLinkPath: string;
  };
  referredCount: number;
  totalEarnedUsdc: number;
  totalWithdrawnUsdc: number;
  reservedUsdc: number;
  availableUsdc: number;
  currency: string;
  recentReferrals: Array<{
    referredWallet: string;
    referralCode: string | null;
    source: string;
    attributedAt: string;
  }>;
  recentEarnings: Array<{
    id: string;
    referredWallet: string;
    paymentAmount: number;
    rewardAmount: number;
    currency: string;
    createdAt: string;
  }>;
  recentWithdrawals: Array<{
    id: string;
    amount: number;
    currency: string;
    status: string;
    payoutTxHash: string | null;
    explorerUrl: string | null;
    createdAt: string;
    completedAt: string | null;
    errorMessage: string | null;
  }>;
}

export interface AffiliateDashboardService {
  getStats(walletAddress: string): Promise<AffiliateDashboardStats | null>;
  getAvailableBalanceUsdc(walletAddress: string): Promise<number>;
}

function roundUsdc(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export function createAffiliateDashboardService(deps: {
  affiliateRepo: AffiliateRepository;
  attributionRepo: ReferralAttributionRepository;
  earningRepo: AffiliateEarningRepository;
  withdrawalRepo: AffiliateWithdrawalRepository;
}): AffiliateDashboardService {
  async function loadAffiliate(wallet: string): Promise<AffiliateRow | null> {
    const result = await deps.affiliateRepo.findByWallet(wallet);
    if (!result.ok || !result.value) return null;
    return result.value;
  }

  return {
    async getAvailableBalanceUsdc(walletAddress) {
      const wallet = normalizeAffiliateWallet(walletAddress);
      if (!wallet) return 0;

      const [earned, reserved] = await Promise.all([
        deps.earningRepo.sumEarnedByAffiliate(wallet),
        deps.withdrawalRepo.sumReservedOrPaid(wallet),
      ]);

      const totalEarned = earned.ok ? earned.value : 0;
      const totalReserved = reserved.ok ? reserved.value : 0;
      return roundUsdc(Math.max(0, totalEarned - totalReserved));
    },

    async getStats(walletAddress) {
      const wallet = normalizeAffiliateWallet(walletAddress);
      if (!wallet) return null;

      const affiliate = await loadAffiliate(wallet);
      if (!affiliate || affiliate.status === "suspended") return null;

      const [countResult, earnedResult, reservedResult, completedResult, referrals, earnings, withdrawals] =
        await Promise.all([
          deps.attributionRepo.countByAffiliate(wallet),
          deps.earningRepo.sumEarnedByAffiliate(wallet),
          deps.withdrawalRepo.sumReservedOrPaid(wallet),
          deps.withdrawalRepo.sumCompleted(wallet),
          deps.attributionRepo.listByAffiliate(wallet, 25),
          deps.earningRepo.listByAffiliate(wallet, 25),
          deps.withdrawalRepo.listByAffiliate(wallet, 25),
        ]);

      const totalEarned = earnedResult.ok ? earnedResult.value : 0;
      const reserved = reservedResult.ok ? reservedResult.value : 0;
      const withdrawn = completedResult.ok ? completedResult.value : 0;
      const available = roundUsdc(Math.max(0, totalEarned - reserved));

      const code = affiliate.referral_code;
      const referralLinkPath = code
        ? `/?ref=${encodeURIComponent(code)}`
        : `/?ref=${encodeURIComponent(wallet)}`;

      return {
        affiliate: {
          walletAddress: affiliate.wallet_address,
          displayName: affiliate.display_name,
          referralCode: affiliate.referral_code,
          status: affiliate.status,
          referralLinkPath,
        },
        referredCount: countResult.ok ? countResult.value : 0,
        totalEarnedUsdc: roundUsdc(totalEarned),
        totalWithdrawnUsdc: roundUsdc(withdrawn),
        reservedUsdc: roundUsdc(reserved - withdrawn),
        availableUsdc: available,
        currency: "USDC",
        recentReferrals: (referrals.ok ? referrals.value : []).map((r) => ({
          referredWallet: r.referred_wallet,
          referralCode: r.referral_code,
          source: r.source,
          attributedAt: r.attributed_at,
        })),
        recentEarnings: (earnings.ok ? earnings.value : []).map((e) => ({
          id: e.id,
          referredWallet: e.referred_wallet,
          paymentAmount: Number(e.payment_amount),
          rewardAmount: Number(e.reward_amount),
          currency: e.currency,
          createdAt: e.created_at,
        })),
        recentWithdrawals: (withdrawals.ok ? withdrawals.value : []).map((w) => ({
          id: w.id,
          amount: Number(w.amount),
          currency: w.currency,
          status: w.status,
          payoutTxHash: w.payout_tx_hash,
          explorerUrl: w.explorer_url,
          createdAt: w.created_at,
          completedAt: w.completed_at,
          errorMessage: w.error_message,
        })),
      };
    },
  };
}
