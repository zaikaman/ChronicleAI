// Sponsored Watch Repository
// Handles CRUD for sponsored_watches

import type { SupabaseClient } from "@supabase/supabase-js";
import { type Result, ValidationError, failure, success } from "./errors.ts";
import {
  buildPaginatedResult,
  mapPostgrestError,
  maybeRow,
  normalizePagination,
  type PaginatedResult,
  type PaginationParams,
} from "./repository-utils.ts";
import type { SponsoredWatchInsert, SponsoredWatchRow, SponsoredWatchUpdate } from "./types.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Maximum number of active campaigns one scheduler/public query may hydrate. */
export const SPONSORED_WATCH_BATCH_LIMIT = 25;

function normalizeWatchBatchLimit(limit: number): number {
  if (!Number.isFinite(limit)) return SPONSORED_WATCH_BATCH_LIMIT;
  return Math.min(Math.max(Math.floor(limit), 1), SPONSORED_WATCH_BATCH_LIMIT);
}

export interface SponsoredWatchRepository {
  create(watch: SponsoredWatchInsert): Promise<Result<SponsoredWatchRow>>;
  findById(id: string): Promise<Result<SponsoredWatchRow | null>>;
  list(): Promise<Result<SponsoredWatchRow[]>>;
  /** Page-based public campaign list (newest first). */
  listPage(params?: PaginationParams): Promise<Result<PaginatedResult<SponsoredWatchRow>>>;
  listActive(limit?: number): Promise<Result<SponsoredWatchRow[]>>;
  /** Watches past ends_at that still need report generation / publish. */
  listDueForCompletion(nowIso?: string, limit?: number): Promise<Result<SponsoredWatchRow[]>>;
  /**
   * Completed campaigns whose narrative fields are missing or placeholder junk
   * (e.g. LLM emitted "..."). Used by the campaign cycle to backfill copy
   * without re-running on-chain publish when a report tx already exists.
   */
  listCompletedNeedingReportRepair(limit?: number): Promise<Result<SponsoredWatchRow[]>>;
  /** Accepted watches whose starts_at has arrived. */
  listDueForActivation(nowIso?: string, limit?: number): Promise<Result<SponsoredWatchRow[]>>;
  /** Active campaigns currently inside their monitoring window. */
  listInMonitoringWindow(nowIso?: string, limit?: number): Promise<Result<SponsoredWatchRow[]>>;
  update(id: string, update: SponsoredWatchUpdate): Promise<Result<SponsoredWatchRow>>;
  updateStatus(
    id: string,
    status: string,
    extraFields?: Partial<SponsoredWatchUpdate>,
  ): Promise<Result<SponsoredWatchRow>>;
}

export function createSponsoredWatchRepository(supabase: SupabaseClient): SponsoredWatchRepository {
  const table = () => supabase.from("sponsored_watches");

  return {
    async create(watch) {
      const { data, error } = await table().insert(watch).select().single();

      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as SponsoredWatchRow);
    },

    async findById(id) {
      if (!UUID_RE.test(id)) {
        return success(null);
      }
      const { data, error } = await table().select("*").eq("id", id).limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow(data ?? []));
    },

    async list() {
      const { data, error } = await table().select("*").order("created_at", { ascending: false });

      if (error) return failure(mapPostgrestError(error));
      return success((data ?? []) as unknown as SponsoredWatchRow[]);
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
      const items = (data ?? []) as unknown as SponsoredWatchRow[];
      return success(buildPaginatedResult(items, page, limit, count ?? items.length));
    },

    async listActive(limit = SPONSORED_WATCH_BATCH_LIMIT) {
      const safeLimit = normalizeWatchBatchLimit(limit);
      const { data, error } = await table()
        .select("*")
        .in("status", ["accepted", "monitoring"])
        .order("created_at", { ascending: false })
        .limit(safeLimit);

      if (error) return failure(mapPostgrestError(error));
      return success((data ?? []) as unknown as SponsoredWatchRow[]);
    },

    async listDueForCompletion(nowIso, limit = SPONSORED_WATCH_BATCH_LIMIT) {
      const now = nowIso ?? new Date().toISOString();
      const safeLimit = normalizeWatchBatchLimit(limit);
      const { data, error } = await table()
        .select("*")
        .in("status", ["accepted", "monitoring"])
        .lte("ends_at", now)
        .order("ends_at", { ascending: true })
        .limit(safeLimit);

      if (error) return failure(mapPostgrestError(error));
      return success((data ?? []) as unknown as SponsoredWatchRow[]);
    },

    async listCompletedNeedingReportRepair(limit = 25) {
      const safeLimit = Math.min(Math.max(limit, 1), 100);
      // Pull recent completed rows; placeholder detection is applied in the
      // service layer (PostgREST cannot express "title is '...'" cleanly with
      // all junk variants without an RPC).
      const { data, error } = await table()
        .select("*")
        .eq("status", "completed")
        .order("ends_at", { ascending: false })
        .limit(safeLimit);

      if (error) return failure(mapPostgrestError(error));
      return success((data ?? []) as unknown as SponsoredWatchRow[]);
    },

    async listDueForActivation(nowIso, limit = SPONSORED_WATCH_BATCH_LIMIT) {
      const now = nowIso ?? new Date().toISOString();
      const safeLimit = normalizeWatchBatchLimit(limit);
      const { data, error } = await table()
        .select("*")
        .eq("status", "accepted")
        .lte("starts_at", now)
        .gt("ends_at", now)
        .order("starts_at", { ascending: true })
        .limit(safeLimit);

      if (error) return failure(mapPostgrestError(error));
      return success((data ?? []) as unknown as SponsoredWatchRow[]);
    },

    async listInMonitoringWindow(nowIso, limit = SPONSORED_WATCH_BATCH_LIMIT) {
      const now = nowIso ?? new Date().toISOString();
      const safeLimit = normalizeWatchBatchLimit(limit);
      const { data, error } = await table()
        .select("*")
        .eq("status", "monitoring")
        .lte("starts_at", now)
        .gt("ends_at", now)
        .order("starts_at", { ascending: true })
        .limit(safeLimit);

      if (error) return failure(mapPostgrestError(error));
      return success((data ?? []) as unknown as SponsoredWatchRow[]);
    },

    async update(id, update) {
      if (!UUID_RE.test(id)) {
        return failure(new ValidationError("Invalid UUID format"));
      }
      const { data, error } = await table().update(update).eq("id", id).select().single();

      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as SponsoredWatchRow);
    },

    async updateStatus(id, status, extraFields) {
      const update: SponsoredWatchUpdate = { ...extraFields, status } as SponsoredWatchUpdate;
      return this.update(id, update);
    },
  };
}
