// Payout Record Repository
// Handles CRUD for payout_records

import type { SupabaseClient } from "@supabase/supabase-js";
import { type Result, failure, success } from "./errors.ts";
import {
  buildInsertPayload,
  buildPaginatedResult,
  buildUpdatePayload,
  mapPostgrestError,
  normalizePagination,
  type PaginatedResult,
  type PaginationParams,
} from "./repository-utils.ts";
import type { RevenuePayoutInsert, RevenuePayoutRow, RevenuePayoutUpdate } from "./types.ts";

export interface PayoutRecordRepository {
  create(payout: RevenuePayoutInsert): Promise<Result<RevenuePayoutRow>>;
  findById(id: string): Promise<Result<RevenuePayoutRow | null>>;
  findByPeriod(
    periodHash: string,
    limitParam?: number,
  ): Promise<Result<RevenuePayoutRow[]>>;
  list(limitParam?: number): Promise<Result<RevenuePayoutRow[]>>;
  listPage(params?: PaginationParams): Promise<Result<PaginatedResult<RevenuePayoutRow>>>;
  update(id: string, update: RevenuePayoutUpdate): Promise<Result<RevenuePayoutRow>>;
  markTransferred(
    id: string,
    payoutTxHash: string,
    registryTxHash: string,
    metadata?: {
      keeperHubRunId?: string;
      explorerUrl?: string;
      transferKeeperHubRunId?: string;
      transferExplorerUrl?: string;
    },
  ): Promise<Result<RevenuePayoutRow>>;
  markFailed(id: string): Promise<Result<RevenuePayoutRow>>;
}

export function createPayoutRecordRepository(supabase: SupabaseClient): PayoutRecordRepository {
  const table = () => supabase.from("payout_records");

  return {
    async create(payout) {
      const payload = buildInsertPayload(payout as unknown as Record<string, unknown>);
      const { data, error } = await table().insert(payload).select().single();

      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as RevenuePayoutRow);
    },

    async findById(id) {
      const { data, error } = await table().select("*").eq("id", id).limit(1);

      if (error) return failure(mapPostgrestError(error));

      const row = (data?.[0] as RevenuePayoutRow | undefined) ?? null;
      return success(row);
    },

    async findByPeriod(periodHash, limitParam = 100) {
      // P2-1: bound payouts for a single period hash.
      const limit = Math.min(200, Math.max(1, limitParam));
      const { data, error } = await table()
        .select("*")
        .eq("payout_period_hash", periodHash)
        .order("created_at", { ascending: false })
        .limit(limit);

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

    async listPage(params) {
      const { page, limit, offset } = normalizePagination(params, {
        defaultLimit: 15,
        maxLimit: 100,
      });

      const { data, error, count } = await table()
        .select("*", { count: params?.countMode ?? "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) return failure(mapPostgrestError(error));
      const items = (data ?? []) as unknown as RevenuePayoutRow[];
      return success(buildPaginatedResult(items, page, limit, count ?? items.length));
    },

    async update(id, update) {
      const payload = buildUpdatePayload(update as unknown as Record<string, unknown>);
      const { data, error } = await table().update(payload).eq("id", id).select().single();

      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as RevenuePayoutRow);
    },

    async markTransferred(id, payoutTxHash, registryTxHash, metadata) {
      const update: RevenuePayoutUpdate = {
        status: "transferred",
        payout_tx_hash: payoutTxHash,
        registry_tx_hash: registryTxHash,
      };
      if (metadata?.keeperHubRunId) {
        update.keeper_hub_run_id = metadata.keeperHubRunId;
      }
      if (metadata?.explorerUrl) {
        update.explorer_url = metadata.explorerUrl;
      }
      if (metadata?.transferKeeperHubRunId) {
        update.transfer_keeper_hub_run_id = metadata.transferKeeperHubRunId;
      }
      if (metadata?.transferExplorerUrl) {
        update.transfer_explorer_url = metadata.transferExplorerUrl;
      }
      return this.update(id, update);
    },

    async markFailed(id) {
      return this.update(id, { status: "failed" } as RevenuePayoutUpdate);
    },
  };
}
