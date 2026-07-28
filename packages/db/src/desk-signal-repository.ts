// Desk signal repository: ingest, dedupe lookup, recent lists

import { DESK_CHAIN_ID, type DeskSignalType } from "@chronicleai/schemas";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Result, failure, success } from "./errors.ts";
import { mapPostgrestError, maybeRow } from "./repository-utils.ts";
import type { DeskSignalInsert, DeskSignalRow } from "./types.ts";

export interface DeskSignalRepository {
  create(data: DeskSignalInsert): Promise<Result<DeskSignalRow>>;
  findById(id: string): Promise<Result<DeskSignalRow | null>>;
  findByDedupeKey(dedupeKey: string): Promise<Result<DeskSignalRow | null>>;
  listRecent(limitParam?: number): Promise<Result<DeskSignalRow[]>>;
  listByType(
    signalType: DeskSignalType,
    limitParam?: number,
  ): Promise<Result<DeskSignalRow[]>>;
}

export function createDeskSignalRepository(
  supabase: SupabaseClient,
): DeskSignalRepository {
  const table = () => supabase.from("desk_signals");

  return {
    async create(data) {
      const payload = {
        signal_type: data.signal_type,
        chain_id: data.chain_id ?? DESK_CHAIN_ID,
        severity: data.severity ?? 0,
        features: data.features ?? {},
        sources: data.sources ?? {},
        policy_verdict: data.policy_verdict ?? "ignore",
        dedupe_key: data.dedupe_key,
        created_at: data.created_at ?? new Date().toISOString(),
      };

      const { data: row, error } = await table().insert(payload).select().single();

      if (error) return failure(mapPostgrestError(error));
      return success(row as unknown as DeskSignalRow);
    },

    async findById(id) {
      const { data, error } = await table().select("*").eq("id", id).limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow((data ?? []) as DeskSignalRow[]));
    },

    async findByDedupeKey(dedupeKey) {
      const { data, error } = await table()
        .select("*")
        .eq("dedupe_key", dedupeKey)
        .limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow((data ?? []) as DeskSignalRow[]));
    },

    async listRecent(limitParam = 50) {
      const limit = Math.min(200, Math.max(1, limitParam));

      const { data, error } = await table()
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) return failure(mapPostgrestError(error));
      return success((data ?? []) as DeskSignalRow[]);
    },

    async listByType(signalType, limitParam = 50) {
      const limit = Math.min(200, Math.max(1, limitParam));

      const { data, error } = await table()
        .select("*")
        .eq("signal_type", signalType)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) return failure(mapPostgrestError(error));
      return success((data ?? []) as DeskSignalRow[]);
    },
  };
}
