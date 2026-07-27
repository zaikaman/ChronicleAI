// Payout Record Repository
// Handles CRUD for payout_records

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RevenuePayoutInsert, RevenuePayoutRow, RevenuePayoutUpdate } from "./types.ts";
import { type Result, failure, success } from "./errors.ts";
import { buildInsertPayload, buildUpdatePayload, mapPostgrestError } from "./repository-utils.ts";

export interface PayoutRecordRepository {
  create(payout: RevenuePayoutInsert): Promise<Result<RevenuePayoutRow>>;
  findById(id: string): Promise<Result<RevenuePayoutRow | null>>;
  findByPeriod(periodHash: string): Promise<Result<RevenuePayoutRow[]>>;
  list(limitParam?: number): Promise<Result<RevenuePayoutRow[]>>;
  update(id: string, update: RevenuePayoutUpdate): Promise<Result<RevenuePayoutRow>>;
  markTransferred(
    id: string,
    payoutTxHash: string,
    registryTxHash: string,
  ): Promise<Result<RevenuePayoutRow>>;
  markFailed(id: string): Promise<Result<RevenuePayoutRow>>;
}

export function createPayoutRecordRepository(
  supabase: SupabaseClient,
): PayoutRecordRepository {
  const table = () => supabase.from("payout_records");

  return {
    async create(payout) {
      const payload = buildInsertPayload(payout as unknown as Record<string, unknown>);
      const { data, error } = await table().insert(payload).select().single();

      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as RevenuePayoutRow);
    },

    async findById(id) {
      const { data, error } = await table()
        .select("*")
        .eq("id", id)
        .limit(1);

      if (error) return failure(mapPostgrestError(error));

      const row = (data?.[0] as RevenuePayoutRow | undefined) ?? null;
      return success(row);
    },

    async findByPeriod(periodHash) {
      const { data, error } = await table()
        .select("*")
        .eq("payout_period_hash", periodHash)
        .order("created_at", { ascending: false });

      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as RevenuePayoutRow[]);
    },

    async list(limitParam = 50) {
      const limit = Math.min(100, Math.max(1, limitParam));

      const { data, error } = await table()
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as RevenuePayoutRow[]);
    },

    async update(id, update) {
      const payload = buildUpdatePayload(update as unknown as Record<string, unknown>);
      const { data, error } = await table()
        .update(payload)
        .eq("id", id)
        .select()
        .single();

      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as RevenuePayoutRow);
    },

    async markTransferred(id, payoutTxHash, registryTxHash) {
      return this.update(id, {
        status: "transferred",
        payout_tx_hash: payoutTxHash,
        registry_tx_hash: registryTxHash,
      } as RevenuePayoutUpdate);
    },

    async markFailed(id) {
      return this.update(id, { status: "failed" } as RevenuePayoutUpdate);
    },
  };
}
