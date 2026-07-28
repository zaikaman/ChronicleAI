// Repository: affiliate earning ledger (credits from settled referred payments)

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeAffiliateWallet } from "./affiliate-repository.ts";
import { type Result, ValidationError, failure, success } from "./errors.ts";
import { mapPostgrestError, maybeRow } from "./repository-utils.ts";
import type { AffiliateEarningInsert, AffiliateEarningRow } from "./types.ts";

export interface AffiliateEarningRepository {
  credit(input: AffiliateEarningInsert): Promise<Result<AffiliateEarningRow>>;
  findByPaymentRecordId(
    paymentRecordId: string,
  ): Promise<Result<AffiliateEarningRow | null>>;
  listByAffiliate(
    affiliateWallet: string,
    limit?: number,
  ): Promise<Result<AffiliateEarningRow[]>>;
  /** Sum of reward_amount for affiliate (all-time earned). */
  sumEarnedByAffiliate(affiliateWallet: string): Promise<Result<number>>;
}

export function createAffiliateEarningRepository(
  supabase: SupabaseClient,
): AffiliateEarningRepository {
  const table = () => supabase.from("affiliate_earnings");

  return {
    async credit(input) {
      const affiliate = normalizeAffiliateWallet(input.affiliate_wallet);
      const referred = normalizeAffiliateWallet(input.referred_wallet);
      if (!affiliate) {
        return failure(new ValidationError("Invalid affiliate_wallet"));
      }
      if (!referred) {
        return failure(new ValidationError("Invalid referred_wallet"));
      }
      if (!(input.reward_amount >= 0) || !Number.isFinite(input.reward_amount)) {
        return failure(new ValidationError("reward_amount must be a non-negative number"));
      }
      if (!(input.payment_amount >= 0) || !Number.isFinite(input.payment_amount)) {
        return failure(new ValidationError("payment_amount must be a non-negative number"));
      }
      if (
        !(input.reward_share >= 0) ||
        !(input.reward_share <= 1) ||
        !Number.isFinite(input.reward_share)
      ) {
        return failure(new ValidationError("reward_share must be in [0, 1]"));
      }
      if (!input.payment_record_id?.trim()) {
        return failure(new ValidationError("payment_record_id is required"));
      }

      // Do not use buildInsertPayload — affiliate_earnings has created_at only
      // (no updated_at). PostgREST rejects unknown columns.
      const payload = {
        affiliate_wallet: affiliate,
        referred_wallet: referred,
        payment_record_id: input.payment_record_id,
        payment_amount: input.payment_amount,
        reward_share: input.reward_share,
        reward_amount: input.reward_amount,
        currency: input.currency ?? "USDC",
        created_at: new Date().toISOString(),
      };
      const { data, error } = await table().insert(payload).select().single();

      if (error) {
        // Idempotent: already credited this payment.
        if (error.code === "23505") {
          const existing = await this.findByPaymentRecordId(input.payment_record_id);
          if (!existing.ok) return existing;
          if (existing.value) return success(existing.value);
        }
        return failure(mapPostgrestError(error));
      }

      return success(data as unknown as AffiliateEarningRow);
    },

    async findByPaymentRecordId(paymentRecordId) {
      const { data, error } = await table()
        .select("*")
        .eq("payment_record_id", paymentRecordId)
        .limit(1);
      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow(data ?? []) as AffiliateEarningRow | null);
    },

    async listByAffiliate(affiliateWallet, limit = 100) {
      const affiliate = normalizeAffiliateWallet(affiliateWallet);
      if (!affiliate) {
        return failure(new ValidationError("Invalid affiliate wallet"));
      }
      const safeLimit = Math.min(Math.max(limit, 1), 500);
      const { data, error } = await table()
        .select("*")
        .eq("affiliate_wallet", affiliate)
        .order("created_at", { ascending: false })
        .limit(safeLimit);
      if (error) return failure(mapPostgrestError(error));
      return success((data ?? []) as AffiliateEarningRow[]);
    },

    async sumEarnedByAffiliate(affiliateWallet) {
      const affiliate = normalizeAffiliateWallet(affiliateWallet);
      if (!affiliate) {
        return failure(new ValidationError("Invalid affiliate wallet"));
      }
      const { data, error } = await supabase.rpc("sum_affiliate_earned", {
        p_affiliate_wallet: affiliate,
      });
      if (error) return failure(mapPostgrestError(error));
      const n = Number(data ?? 0);
      return success(Number.isFinite(n) ? n : 0);
    },
  };
}
