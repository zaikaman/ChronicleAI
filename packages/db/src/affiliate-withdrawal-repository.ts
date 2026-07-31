// Repository: agent-initiated affiliate USDC withdrawals

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeAffiliateWallet } from "./affiliate-repository.ts";
import { type Result, ValidationError, failure, success } from "./errors.ts";
import {
  buildInsertPayload,
  buildUpdatePayload,
  mapPostgrestError,
  maybeRow,
} from "./repository-utils.ts";
import type {
  AffiliateWithdrawalInsert,
  AffiliateWithdrawalRow,
  AffiliateWithdrawalUpdate,
} from "./types.ts";

export interface AffiliateWithdrawalRepository {
  consumeAuthorizationNonce?(params: { nonce: string; affiliate_wallet: string; expires_at: string }): Promise<Result<boolean>>;
  create(input: AffiliateWithdrawalInsert): Promise<Result<AffiliateWithdrawalRow>>;
  findById(id: string): Promise<Result<AffiliateWithdrawalRow | null>>;
  listByAffiliate(
    affiliateWallet: string,
    limit?: number,
  ): Promise<Result<AffiliateWithdrawalRow[]>>;
  /** Sum of amounts for pending + processing + completed (reserved / paid out). */
  sumReservedOrPaid(affiliateWallet: string): Promise<Result<number>>;
  /** Sum of completed withdrawal amounts only. */
  sumCompleted(affiliateWallet: string): Promise<Result<number>>;
  update(
    id: string,
    updates: AffiliateWithdrawalUpdate,
  ): Promise<Result<AffiliateWithdrawalRow>>;
  markProcessing(id: string): Promise<Result<AffiliateWithdrawalRow>>;
  markCompleted(
    id: string,
    meta: {
      payout_tx_hash: string;
      registry_tx_hash?: string | null;
      keeper_hub_run_id?: string | null;
      explorer_url?: string | null;
      payout_record_id?: string | null;
    },
  ): Promise<Result<AffiliateWithdrawalRow>>;
  markFailed(id: string, errorMessage: string): Promise<Result<AffiliateWithdrawalRow>>;
}

export function createAffiliateWithdrawalRepository(
  supabase: SupabaseClient,
): AffiliateWithdrawalRepository {
  const table = () => supabase.from("affiliate_withdrawals");

  async function sumByStatuses(
    affiliateWallet: string,
    statuses: string[],
  ): Promise<Result<number>> {
    const affiliate = normalizeAffiliateWallet(affiliateWallet);
    if (!affiliate) {
      return failure(new ValidationError("Invalid affiliate wallet"));
    }
    const { data, error } = await supabase.rpc("sum_affiliate_withdrawals", {
      p_affiliate_wallet: affiliate,
      p_statuses: statuses,
    });
    if (error) return failure(mapPostgrestError(error));
    const n = Number(data ?? 0);
    return success(Number.isFinite(n) ? n : 0);
  }

  return {
    async consumeAuthorizationNonce(params) {
      const { error } = await supabase.from("affiliate_withdrawal_nonces").insert({
        nonce: params.nonce,
        affiliate_wallet: normalizeAffiliateWallet(params.affiliate_wallet),
        expires_at: params.expires_at,
      });
      if (!error) return success(true);
      if (error.code === "23505") return success(false);
      return failure(mapPostgrestError(error));
    },
    async create(input) {
      const affiliate = normalizeAffiliateWallet(input.affiliate_wallet);
      if (!affiliate) {
        return failure(new ValidationError("Invalid affiliate_wallet"));
      }
      if (!(input.amount > 0) || !Number.isFinite(input.amount)) {
        return failure(new ValidationError("amount must be a positive number"));
      }

      const insert: AffiliateWithdrawalInsert = {
        affiliate_wallet: affiliate,
        amount: input.amount,
        currency: input.currency ?? "USDC",
        status: input.status ?? "pending",
        agent_message: input.agent_message ?? null,
      };

      const payload = buildInsertPayload(insert as unknown as Record<string, unknown>);
      const { data, error } = await table().insert(payload).select().single();
      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as AffiliateWithdrawalRow);
    },

    async findById(id) {
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) return success(null);
      const { data, error } = await table().select("*").eq("id", id).limit(1);
      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow(data ?? []) as AffiliateWithdrawalRow | null);
    },

    async listByAffiliate(affiliateWallet, limit = 50) {
      const affiliate = normalizeAffiliateWallet(affiliateWallet);
      if (!affiliate) {
        return failure(new ValidationError("Invalid affiliate wallet"));
      }
      const safeLimit = Math.min(Math.max(limit, 1), 200);
      const { data, error } = await table()
        .select("*")
        .eq("affiliate_wallet", affiliate)
        .order("created_at", { ascending: false })
        .limit(safeLimit);
      if (error) return failure(mapPostgrestError(error));
      return success((data ?? []) as AffiliateWithdrawalRow[]);
    },

    async sumReservedOrPaid(affiliateWallet) {
      return sumByStatuses(affiliateWallet, ["pending", "processing", "completed"]);
    },

    async sumCompleted(affiliateWallet) {
      return sumByStatuses(affiliateWallet, ["completed"]);
    },

    async update(id, updates) {
      const payload = buildUpdatePayload({
        ...(updates as Record<string, unknown>),
        updated_at: new Date().toISOString(),
      });
      const { data, error } = await table()
        .update(payload)
        .eq("id", id)
        .select()
        .single();
      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as AffiliateWithdrawalRow);
    },

    async markProcessing(id) {
      return this.update(id, { status: "processing" });
    },

    async markCompleted(id, meta) {
      return this.update(id, {
        status: "completed",
        payout_tx_hash: meta.payout_tx_hash,
        registry_tx_hash: meta.registry_tx_hash ?? null,
        keeper_hub_run_id: meta.keeper_hub_run_id ?? null,
        explorer_url: meta.explorer_url ?? null,
        payout_record_id: meta.payout_record_id ?? null,
        completed_at: new Date().toISOString(),
        error_message: null,
      });
    },

    async markFailed(id, errorMessage) {
      return this.update(id, {
        status: "failed",
        error_message: errorMessage.slice(0, 1000),
      });
    },
  };
}
