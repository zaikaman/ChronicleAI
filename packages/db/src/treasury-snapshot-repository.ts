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
      // treasury_snapshots has created_at only (no updated_at).
      const payload = buildInsertPayload(snapshot as unknown as Record<string, unknown>, {
        updated_at: false,
      });
      const { data, error } = await table().insert(payload).select().single();

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
      // treasury_snapshots has no updated_at column.
      const payload = buildUpdatePayload(update as unknown as Record<string, unknown>, {
        includeUpdatedAt: false,
      });
      const { data, error } = await table().update(payload).eq("id", id).select().single();

      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as TreasurySnapshotRow);
    },

    async getAggregates() {
      const [latestResult, paymentAggregateResult] = await Promise.all([
        this.findLatest(),
        supabase.rpc("treasury_payment_aggregates"),
      ]);

      if (!latestResult.ok || !latestResult.value) {
        return success({
          totalRevenue: 0,
          totalPaidRequests: 0,
          latestBalance: 0,
          latestStatus: "unknown",
        });
      }

      const latest = latestResult.value;

      const paymentAggregates =
        !paymentAggregateResult.error &&
        paymentAggregateResult.data &&
        typeof paymentAggregateResult.data === "object" &&
        !Array.isArray(paymentAggregateResult.data)
          ? (paymentAggregateResult.data as {
              totalRevenue?: unknown;
              totalPaidRequests?: unknown;
            })
          : null;
      const totalRevenue =
        paymentAggregates && Number.isFinite(Number(paymentAggregates.totalRevenue))
          ? Number(paymentAggregates.totalRevenue)
          : (latest.revenue_total ?? 0);
      const totalPaidRequests =
        paymentAggregates && Number.isFinite(Number(paymentAggregates.totalPaidRequests))
          ? Number(paymentAggregates.totalPaidRequests)
          : (latest.paid_request_count ?? 0);

      return success({
        totalRevenue,
        totalPaidRequests,
        latestBalance: latest.available_balance,
        latestStatus: latest.status,
      });
    },
  };
}
