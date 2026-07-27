// Treasury Snapshot Repository
// Handles CRUD for treasury_snapshots and aggregate queries

import type { SupabaseClient } from "@supabase/supabase-js";
import { type Result, failure, success } from "./errors.ts";
import {
  buildInsertPayload,
  buildUpdatePayload,
  mapPostgrestError,
  maybeRow,
} from "./repository-utils.ts";
import type {
  TreasurySnapshotInsert,
  TreasurySnapshotRow,
  TreasurySnapshotUpdate,
} from "./types.ts";

export interface TreasurySnapshotRepository {
  create(snapshot: TreasurySnapshotInsert): Promise<Result<TreasurySnapshotRow>>;
  findLatest(): Promise<Result<TreasurySnapshotRow | null>>;
  findById(id: string): Promise<Result<TreasurySnapshotRow | null>>;
  list(limitParam?: number): Promise<Result<TreasurySnapshotRow[]>>;
  listStatusHistory(limitParam?: number): Promise<Result<TreasurySnapshotRow[]>>;
  update(id: string, update: TreasurySnapshotUpdate): Promise<Result<TreasurySnapshotRow>>;
  getAggregates(): Promise<
    Result<{
      totalRevenue: number;
      totalPaidRequests: number;
      latestBalance: number;
      latestStatus: string;
    }>
  >;
}

export function createTreasurySnapshotRepository(
  supabase: SupabaseClient,
): TreasurySnapshotRepository {
  const table = () => supabase.from("treasury_snapshots");

  return {
    async create(snapshot) {
      const payload = buildInsertPayload(snapshot as unknown as Record<string, unknown>);
      // updated_at is a generated column; strip it from the insert payload
      const { updated_at: _unused, ...cleanPayload } = payload;
      const { data, error } = await table().insert(cleanPayload).select().single();

      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as TreasurySnapshotRow);
    },

    async findLatest() {
      const { data, error } = await table()
        .select("*")
        .order("captured_at", { ascending: false })
        .limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow(data ?? []));
    },

    async findById(id) {
      const { data, error } = await table().select("*").eq("id", id).limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow(data ?? []));
    },

    async list(limitParam = 50) {
      const limit = Math.min(100, Math.max(1, limitParam));

      const { data, error } = await table()
        .select("*")
        .order("captured_at", { ascending: false })
        .limit(limit);

      if (error) return failure(mapPostgrestError(error));
      return success(data ?? []);
    },

    async listStatusHistory(limitParam = 50) {
      const limit = Math.min(100, Math.max(1, limitParam));

      const { data, error } = await table()
        .select("id, status, available_balance, safety_buffer, captured_at, created_at")
        .order("captured_at", { ascending: false })
        .limit(limit);

      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as TreasurySnapshotRow[]);
    },

    async update(id, update) {
      const payload = buildUpdatePayload(update as unknown as Record<string, unknown>);
      // updated_at is a generated column; strip it from the update payload
      const { updated_at: _unused, ...cleanPayload } = payload;
      const { data, error } = await table().update(cleanPayload).eq("id", id).select().single();

      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as TreasurySnapshotRow);
    },

    async getAggregates() {
      const latestResult = await this.findLatest();

      if (!latestResult.ok || !latestResult.value) {
        return success({
          totalRevenue: 0,
          totalPaidRequests: 0,
          latestBalance: 0,
          latestStatus: "unknown",
        });
      }

      const latest = latestResult.value;

      // Sum revenue from payment_records for a rough aggregate
      const { data: paymentData, error: paymentError } = await supabase
        .from("payment_records")
        .select("amount_settled")
        .eq("status", "settled");

      const totalRevenue = paymentError
        ? (latest.revenue_total ?? 0)
        : (paymentData as Array<{ amount_settled: number | null }>).reduce(
            (sum: number, p: { amount_settled: number | null }) => sum + (p.amount_settled ?? 0),
            0,
          );

      // Count settled payments
      const { data: countData, error: countError } = await supabase
        .from("payment_records")
        .select("id", { count: "exact", head: true })
        .eq("status", "settled");

      return success({
        totalRevenue,
        totalPaidRequests: countError
          ? (latest.paid_request_count ?? 0)
          : ((countData as unknown as { count: number } | null)?.count ?? 0),
        latestBalance: latest.available_balance,
        latestStatus: latest.status,
      });
    },
  };
}
