// Sponsored Watch Repository
// Handles CRUD for sponsored_watches

import type { SupabaseClient } from "@supabase/supabase-js";
import { type Result, ValidationError, failure, success } from "./errors.ts";
import { mapPostgrestError, maybeRow } from "./repository-utils.ts";
import type { SponsoredWatchInsert, SponsoredWatchRow, SponsoredWatchUpdate } from "./types.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SponsoredWatchRepository {
  create(watch: SponsoredWatchInsert): Promise<Result<SponsoredWatchRow>>;
  findById(id: string): Promise<Result<SponsoredWatchRow | null>>;
  list(): Promise<Result<SponsoredWatchRow[]>>;
  listActive(): Promise<Result<SponsoredWatchRow[]>>;
  /** Watches past ends_at that still need report generation / publish. */
  listDueForCompletion(nowIso?: string): Promise<Result<SponsoredWatchRow[]>>;
  /**
   * Completed campaigns whose narrative fields are missing or placeholder junk
   * (e.g. LLM emitted "..."). Used by the campaign cycle to backfill copy
   * without re-running on-chain publish when a report tx already exists.
   */
  listCompletedNeedingReportRepair(limit?: number): Promise<Result<SponsoredWatchRow[]>>;
  /** Accepted watches whose starts_at has arrived. */
  listDueForActivation(nowIso?: string): Promise<Result<SponsoredWatchRow[]>>;
  /** Active campaigns currently inside their monitoring window. */
  listInMonitoringWindow(nowIso?: string): Promise<Result<SponsoredWatchRow[]>>;
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

    async listActive() {
      const { data, error } = await table()
        .select("*")
        .in("status", ["accepted", "monitoring"])
        .order("created_at", { ascending: false });

      if (error) return failure(mapPostgrestError(error));
      return success((data ?? []) as unknown as SponsoredWatchRow[]);
    },

    async listDueForCompletion(nowIso) {
      const now = nowIso ?? new Date().toISOString();
      const { data, error } = await table()
        .select("*")
        .in("status", ["accepted", "monitoring"])
        .lte("ends_at", now)
        .order("ends_at", { ascending: true });

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

    async listDueForActivation(nowIso) {
      const now = nowIso ?? new Date().toISOString();
      const { data, error } = await table()
        .select("*")
        .eq("status", "accepted")
        .lte("starts_at", now)
        .gt("ends_at", now)
        .order("starts_at", { ascending: true });

      if (error) return failure(mapPostgrestError(error));
      return success((data ?? []) as unknown as SponsoredWatchRow[]);
    },

    async listInMonitoringWindow(nowIso) {
      const now = nowIso ?? new Date().toISOString();
      const { data, error } = await table()
        .select("*")
        .eq("status", "monitoring")
        .lte("starts_at", now)
        .gt("ends_at", now)
        .order("starts_at", { ascending: true });

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
