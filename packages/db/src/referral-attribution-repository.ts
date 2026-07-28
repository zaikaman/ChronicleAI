// Repository: first-touch referral attributions (referred wallet → affiliate)

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeAffiliateWallet,
  normalizeReferralCode,
} from "./affiliate-repository.ts";
import { type Result, ValidationError, failure, success } from "./errors.ts";
import {
  buildInsertPayload,
  mapPostgrestError,
  maybeRow,
} from "./repository-utils.ts";
import type {
  ReferralAttributionInsert,
  ReferralAttributionRow,
  ReferralAttributionSource,
} from "./types.ts";

export interface ReferralAttributionRepository {
  findByReferredWallet(
    wallet: string,
  ): Promise<Result<ReferralAttributionRow | null>>;
  listByAffiliate(
    affiliateWallet: string,
    limit?: number,
  ): Promise<Result<ReferralAttributionRow[]>>;
  countByAffiliate(affiliateWallet: string): Promise<Result<number>>;
  /**
   * First-touch only: if referred wallet already has an attribution, returns it
   * without overwriting. Self-referral is rejected.
   */
  attributeFirstTouch(input: {
    referred_wallet: string;
    affiliate_wallet: string;
    referral_code?: string | null;
    source?: ReferralAttributionSource;
  }): Promise<
    Result<{ attribution: ReferralAttributionRow; created: boolean }>
  >;
}

export function createReferralAttributionRepository(
  supabase: SupabaseClient,
): ReferralAttributionRepository {
  const table = () => supabase.from("referral_attributions");

  return {
    async findByReferredWallet(wallet) {
      const normalized = normalizeAffiliateWallet(wallet);
      if (!normalized) {
        return failure(new ValidationError("Invalid referred wallet address"));
      }
      const { data, error } = await table()
        .select("*")
        .eq("referred_wallet", normalized)
        .limit(1);
      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow(data ?? []) as ReferralAttributionRow | null);
    },

    async listByAffiliate(affiliateWallet, limit = 100) {
      const affiliate = normalizeAffiliateWallet(affiliateWallet);
      if (!affiliate) {
        return failure(new ValidationError("Invalid affiliate wallet address"));
      }
      const safeLimit = Math.min(Math.max(limit, 1), 500);
      const { data, error } = await table()
        .select("*")
        .eq("affiliate_wallet", affiliate)
        .order("attributed_at", { ascending: false })
        .limit(safeLimit);
      if (error) return failure(mapPostgrestError(error));
      return success((data ?? []) as ReferralAttributionRow[]);
    },

    async countByAffiliate(affiliateWallet) {
      const affiliate = normalizeAffiliateWallet(affiliateWallet);
      if (!affiliate) {
        return failure(new ValidationError("Invalid affiliate wallet address"));
      }
      const { count, error } = await table()
        .select("id", { count: "exact", head: true })
        .eq("affiliate_wallet", affiliate);
      if (error) return failure(mapPostgrestError(error));
      return success(count ?? 0);
    },

    async attributeFirstTouch(input) {
      const referred = normalizeAffiliateWallet(input.referred_wallet);
      const affiliate = normalizeAffiliateWallet(input.affiliate_wallet);
      if (!referred) {
        return failure(new ValidationError("referred_wallet must be a valid 0x address"));
      }
      if (!affiliate) {
        return failure(new ValidationError("affiliate_wallet must be a valid 0x address"));
      }
      if (referred === affiliate) {
        return failure(new ValidationError("Cannot attribute a wallet to itself as affiliate"));
      }

      const existing = await this.findByReferredWallet(referred);
      if (!existing.ok) return existing;
      if (existing.value) {
        return success({ attribution: existing.value, created: false });
      }

      const code =
        input.referral_code != null && String(input.referral_code).trim()
          ? normalizeReferralCode(input.referral_code)
          : null;

      const insert: ReferralAttributionInsert = {
        referred_wallet: referred,
        affiliate_wallet: affiliate,
        referral_code: code,
        source: input.source ?? "web_connect",
      };

      const payload = buildInsertPayload(insert as unknown as Record<string, unknown>);
      const { data, error } = await table().insert(payload).select().single();

      if (error) {
        // Race: another request inserted first-touch — return existing.
        if (error.code === "23505") {
          const again = await this.findByReferredWallet(referred);
          if (!again.ok) return again;
          if (again.value) {
            return success({ attribution: again.value, created: false });
          }
        }
        return failure(mapPostgrestError(error));
      }

      return success({
        attribution: data as unknown as ReferralAttributionRow,
        created: true,
      });
    },
  };
}
