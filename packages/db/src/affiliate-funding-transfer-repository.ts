// Repository: idempotent treasury funding records for the KeeperHub affiliate float.

import type { SupabaseClient } from "@supabase/supabase-js";
import { type Result, ValidationError, failure, success } from "./errors.ts";
import {
  mapPostgrestError,
  maybeRow,
} from "./repository-utils.ts";
import type {
  AffiliateFundingTransferInsert,
  AffiliateFundingTransferRow,
} from "./types.ts";

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export interface AffiliateFundingTransferRepository {
  createForEarning(
    input: AffiliateFundingTransferInsert,
  ): Promise<Result<AffiliateFundingTransferRow>>;
  findByEarningId(
    earningId: string,
  ): Promise<Result<AffiliateFundingTransferRow | null>>;
  listRetryable(limit?: number): Promise<Result<AffiliateFundingTransferRow[]>>;
  /** Claim a pending/failed row. Processing rows require reconciliation. */
  claim(id: string): Promise<Result<AffiliateFundingTransferRow | null>>;
  markCompleted(
    id: string,
    meta: { txHash: string; explorerUrl?: string | null },
  ): Promise<Result<AffiliateFundingTransferRow>>;
  markFailed(
    id: string,
    errorMessage: string,
  ): Promise<Result<AffiliateFundingTransferRow>>;
}

export function createAffiliateFundingTransferRepository(
  supabase: SupabaseClient,
): AffiliateFundingTransferRepository {
  const table = () => supabase.from("affiliate_funding_transfers");

  return {
    async createForEarning(input) {
      if (!input.affiliate_earning_id?.trim()) {
        return failure(new ValidationError("affiliate_earning_id is required"));
      }
      if (!(input.amount > 0) || !Number.isFinite(input.amount)) {
        return failure(new ValidationError("amount must be positive and finite"));
      }
      if (!EVM_ADDRESS_RE.test(input.destination_wallet)) {
        return failure(new ValidationError("Invalid destination_wallet"));
      }
      if (!EVM_ADDRESS_RE.test(input.token_address)) {
        return failure(new ValidationError("Invalid token_address"));
      }
      if (!Number.isInteger(input.chain_id) || input.chain_id <= 0) {
        return failure(new ValidationError("chain_id must be a positive integer"));
      }

      const payload = {
        affiliate_earning_id: input.affiliate_earning_id.trim(),
        amount: input.amount,
        currency: input.currency ?? "USDC",
        destination_wallet: input.destination_wallet.toLowerCase(),
        chain_id: input.chain_id,
        token_address: input.token_address.toLowerCase(),
        status: input.status ?? "pending",
        attempt_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await table().insert(payload).select().single();
      if (!error) return success(data as unknown as AffiliateFundingTransferRow);

      if (error.code === "23505") {
        const existing = await this.findByEarningId(input.affiliate_earning_id);
        if (!existing.ok) return existing;
        if (existing.value) return success(existing.value);
      }
      return failure(mapPostgrestError(error));
    },

    async findByEarningId(earningId) {
      const { data, error } = await table()
        .select("*")
        .eq("affiliate_earning_id", earningId)
        .limit(1);
      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow(data ?? []) as AffiliateFundingTransferRow | null);
    },

    async listRetryable(limit = 100) {
      const safeLimit = Math.min(Math.max(limit, 1), 500);
      const { data, error } = await table()
        .select("*")
        // A processing row may already have broadcast its transfer. It must
        // never be reclaimed automatically because doing so can pay twice.
        .in("status", ["pending", "failed"])
        .order("updated_at", { ascending: true })
        .limit(500);
      if (error) return failure(mapPostgrestError(error));
      return success(
        ((data ?? []) as AffiliateFundingTransferRow[])
          .slice(0, safeLimit),
      );
    },

    async claim(id) {
      const current = await table().select("*").eq("id", id).limit(1);
      if (current.error) return failure(mapPostgrestError(current.error));
      const row = maybeRow(current.data ?? []) as AffiliateFundingTransferRow | null;
      if (
        !row ||
        (row.status !== "pending" && row.status !== "failed")
      ) {
        return success(null);
      }

      const { data, error } = await table()
        .update({
          status: "processing",
          attempt_count: row.attempt_count + 1,
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("status", row.status)
        .eq("updated_at", row.updated_at)
        .select()
        .limit(1);
      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow(data ?? []) as AffiliateFundingTransferRow | null);
    },

    async markCompleted(id, meta) {
      if (!meta.txHash?.trim()) {
        return failure(new ValidationError("txHash is required"));
      }
      const { data, error } = await table()
        .update({
          status: "completed",
          tx_hash: meta.txHash,
          explorer_url: meta.explorerUrl ?? null,
          error_message: null,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single();
      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as AffiliateFundingTransferRow);
    },

    async markFailed(id, errorMessage) {
      const { data, error } = await table()
        .update({
          status: "failed",
          error_message: errorMessage.slice(0, 1000),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single();
      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as AffiliateFundingTransferRow);
    },
  };
}
