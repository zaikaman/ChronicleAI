// Desk intent repository: create, state transitions, single-flight lookup

import type { DeskIntentStatus, DeskStrategy } from "@chronicleai/schemas";
import { DESK_OPEN_INTENT_STATUSES } from "@chronicleai/schemas";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Result, failure, success } from "./errors.ts";
import {
  buildInsertPayload,
  buildPaginatedResult,
  buildUpdatePayload,
  mapPostgrestError,
  maybeRow,
  normalizePagination,
  type PaginatedResult,
  type PaginationParams,
} from "./repository-utils.ts";
import type { DeskIntentInsert, DeskIntentRow, DeskIntentUpdate } from "./types.ts";

export interface DeskIntentRepository {
  create(data: DeskIntentInsert): Promise<Result<DeskIntentRow>>;
  findById(id: string): Promise<Result<DeskIntentRow | null>>;
  update(id: string, update: DeskIntentUpdate): Promise<Result<DeskIntentRow>>;
  listRecent(limitParam?: number): Promise<Result<DeskIntentRow[]>>;
  listPage(params?: PaginationParams): Promise<Result<PaginatedResult<DeskIntentRow>>>;
  listByStatus(
    status: DeskIntentStatus,
    limitParam?: number,
  ): Promise<Result<DeskIntentRow[]>>;
  /**
   * Open (proposed | approved | executing) intent for a strategy, if any.
   * Used for single-flight policy.
   */
  findOpenByStrategy(strategy: DeskStrategy): Promise<Result<DeskIntentRow | null>>;
  listOpen(limitParam?: number): Promise<Result<DeskIntentRow[]>>;
}

export function createDeskIntentRepository(
  supabase: SupabaseClient,
): DeskIntentRepository {
  const table = () => supabase.from("desk_intents");

  return {
    async create(data) {
      const payload = buildInsertPayload({
        signal_id: data.signal_id ?? null,
        strategy: data.strategy,
        status: data.status ?? "proposed",
        notional_usdc: data.notional_usdc ?? 0,
        legs: data.legs ?? [],
        reason_codes: data.reason_codes ?? [],
        policy_snapshot: data.policy_snapshot ?? {},
        keeper_hub_run_id: data.keeper_hub_run_id ?? null,
        error_message: data.error_message ?? null,
      } as unknown as Record<string, unknown>);

      const { data: row, error } = await table().insert(payload).select().single();

      if (error) return failure(mapPostgrestError(error));
      return success(row as unknown as DeskIntentRow);
    },

    async findById(id) {
      const { data, error } = await table().select("*").eq("id", id).limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow((data ?? []) as DeskIntentRow[]));
    },

    async update(id, update) {
      const payload = buildUpdatePayload(update as unknown as Record<string, unknown>);
      const { data: row, error } = await table()
        .update(payload)
        .eq("id", id)
        .select()
        .single();

      if (error) return failure(mapPostgrestError(error));
      return success(row as unknown as DeskIntentRow);
    },

    async listRecent(limitParam = 50) {
      const limit = Math.min(200, Math.max(1, limitParam));

      const { data, error } = await table()
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) return failure(mapPostgrestError(error));
      return success((data ?? []) as DeskIntentRow[]);
    },

    async listPage(params) {
      const { page, limit, offset } = normalizePagination(params, {
        defaultLimit: 20,
        maxLimit: 100,
      });

      const { data, error, count } = await table()
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) return failure(mapPostgrestError(error));
      const items = (data ?? []) as DeskIntentRow[];
      return success(buildPaginatedResult(items, page, limit, count ?? items.length));
    },

    async listByStatus(status, limitParam = 50) {
      const limit = Math.min(200, Math.max(1, limitParam));

      const { data, error } = await table()
        .select("*")
        .eq("status", status)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) return failure(mapPostgrestError(error));
      return success((data ?? []) as DeskIntentRow[]);
    },

    async findOpenByStrategy(strategy) {
      const openStatuses = [...DESK_OPEN_INTENT_STATUSES];

      const { data, error } = await table()
        .select("*")
        .eq("strategy", strategy)
        .in("status", openStatuses)
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow((data ?? []) as DeskIntentRow[]));
    },

    async listOpen(limitParam = 50) {
      const limit = Math.min(200, Math.max(1, limitParam));
      const openStatuses = [...DESK_OPEN_INTENT_STATUSES];

      const { data, error } = await table()
        .select("*")
        .in("status", openStatuses)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) return failure(mapPostgrestError(error));
      return success((data ?? []) as DeskIntentRow[]);
    },
  };
}
