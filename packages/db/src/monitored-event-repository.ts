// Monitored event repository: create, find by source/sourceEventId, update status/significance, list

import type { SupabaseClient } from "@supabase/supabase-js";
import { type Result, failure, success } from "./errors.ts";
import {
  type PaginationParams,
  buildInsertPayload,
  buildUpdatePayload,
  expectRow,
  mapPostgrestError,
  normalizePagination,
} from "./repository-utils.ts";
import type { MonitoredEventInsert, MonitoredEventRow, MonitoredEventUpdate } from "./types.ts";

export interface MonitoredEventRepository {
  create(data: MonitoredEventInsert): Promise<Result<MonitoredEventRow>>;
  findById(id: string): Promise<Result<MonitoredEventRow>>;
  findBySourceAndEventId(source: string, sourceEventId: string): Promise<MonitoredEventRow | null>;
  updateStatus(id: string, status: string, score?: number): Promise<Result<MonitoredEventRow>>;
  list(
    params?: PaginationParams & {
      status?: string;
      eventType?: string;
    },
  ): Promise<Result<MonitoredEventRow[]>>;
  /**
   * List events whose captured_at falls inside [periodStart, periodEnd].
   * Used by sponsored-watch campaign matching and digest selection.
   */
  listInWindow(params: {
    periodStart: string;
    periodEnd: string;
    status?: string;
    limit?: number;
  }): Promise<Result<MonitoredEventRow[]>>;
}

export function createMonitoredEventRepository(supabase: SupabaseClient): MonitoredEventRepository {
  const table = () => supabase.from("monitored_events");

  return {
    async create(data) {
      const payload = buildInsertPayload(data as unknown as Record<string, unknown>);
      const { data: rows, error } = await table().insert(payload).select().single();

      if (error) {
        return failure(mapPostgrestError(error));
      }

      return success(rows as unknown as MonitoredEventRow);
    },

    async findById(id) {
      const { data: rows, error } = await table().select("*").eq("id", id);

      if (error) {
        return failure(mapPostgrestError(error));
      }

      return expectRow(rows as unknown as MonitoredEventRow[], "MonitoredEvent", id);
    },

    async findBySourceAndEventId(source, sourceEventId) {
      const { data: rows, error } = await table()
        .select("*")
        .eq("source", source)
        .eq("source_event_id", sourceEventId);

      if (error) {
        return null;
      }

      return (rows?.[0] as unknown as MonitoredEventRow) ?? null;
    },

    async updateStatus(id, status, score?) {
      const update: MonitoredEventUpdate = {
        status: status as MonitoredEventRow["status"],
      };
      if (score !== undefined) {
        update.significance_score = score;
      }

      const payload = buildUpdatePayload(update as unknown as Record<string, unknown>);
      const { data: rows, error } = await table().update(payload).eq("id", id).select().single();

      if (error) {
        return failure(mapPostgrestError(error));
      }

      return success(rows as unknown as MonitoredEventRow);
    },

    async list(params) {
      const pagination = normalizePagination(params);

      let query = table().select("*");

      if (params?.status) {
        query = query.eq("status", params.status);
      }
      if (params?.eventType) {
        query = query.eq("event_type", params.eventType);
      }

      const { data: rows, error } = await query
        .order("created_at", { ascending: false })
        .range(pagination.offset, pagination.offset + pagination.limit - 1);

      if (error) {
        return failure(mapPostgrestError(error));
      }

      return success(rows as unknown as MonitoredEventRow[]);
    },

    async listInWindow({ periodStart, periodEnd, status, limit = 500 }) {
      let query = table()
        .select("*")
        .gte("captured_at", periodStart)
        .lte("captured_at", periodEnd)
        .order("captured_at", { ascending: true })
        .limit(Math.min(Math.max(limit, 1), 2000));

      if (status) {
        query = query.eq("status", status);
      }

      const { data: rows, error } = await query;

      if (error) {
        return failure(mapPostgrestError(error));
      }

      return success((rows ?? []) as unknown as MonitoredEventRow[]);
    },
  };
}
