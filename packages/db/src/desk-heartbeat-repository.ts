// Desk heartbeat repository: kill-switch liveness

import type { DeskHeartbeatSource } from "@chronicleai/schemas";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Result, failure, success } from "./errors.ts";
import { mapPostgrestError, maybeRow } from "./repository-utils.ts";
import type { DeskHeartbeatInsert, DeskHeartbeatRow } from "./types.ts";

/** Default rows to retain after prune (P2-9). */
export const DESK_HEARTBEAT_RETAIN_COUNT = 500;

export interface DeskHeartbeatRepository {
  /** Record a heartbeat tick from api / scheduler / workflow. */
  touch(source: DeskHeartbeatSource): Promise<Result<DeskHeartbeatRow>>;
  create(data: DeskHeartbeatInsert): Promise<Result<DeskHeartbeatRow>>;
  findLatest(): Promise<Result<DeskHeartbeatRow | null>>;
  /**
   * True when no heartbeat exists, or the latest is older than maxAgeMs.
   */
  isStale(maxAgeMs: number, now?: Date): Promise<Result<boolean>>;
  listRecent(limitParam?: number): Promise<Result<DeskHeartbeatRow[]>>;
  /**
   * P2-9: keep latest `keepCount` heartbeats; delete older.
   * Prefers RPC `prune_desk_heartbeats`; falls back to client-side delete.
   */
  pruneKeepLatest(keepCount?: number): Promise<Result<number>>;
}

export function createDeskHeartbeatRepository(
  supabase: SupabaseClient,
): DeskHeartbeatRepository {
  const table = () => supabase.from("desk_heartbeats");

  return {
    async touch(source) {
      return this.create({ source });
    },

    async create(data) {
      const payload = {
        source: data.source,
        created_at: data.created_at ?? new Date().toISOString(),
      };

      const { data: row, error } = await table().insert(payload).select().single();

      if (error) return failure(mapPostgrestError(error));
      return success(row as unknown as DeskHeartbeatRow);
    },

    async findLatest() {
      const { data, error } = await table()
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow((data ?? []) as DeskHeartbeatRow[]));
    },

    async isStale(maxAgeMs, now = new Date()) {
      const latestResult = await this.findLatest();
      if (!latestResult.ok) return latestResult;

      const latest = latestResult.value;
      if (!latest) {
        return success(true);
      }

      const ageMs = now.getTime() - new Date(latest.created_at).getTime();
      return success(ageMs > maxAgeMs);
    },

    async listRecent(limitParam = 20) {
      const limit = Math.min(100, Math.max(1, limitParam));

      const { data, error } = await table()
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) return failure(mapPostgrestError(error));
      return success((data ?? []) as DeskHeartbeatRow[]);
    },

    async pruneKeepLatest(keepCount = DESK_HEARTBEAT_RETAIN_COUNT) {
      const keep = Math.min(5_000, Math.max(1, keepCount));

      const { data: rpcData, error: rpcError } = await supabase.rpc(
        "prune_desk_heartbeats",
        { keep_count: keep },
      );
      if (!rpcError && typeof rpcData === "number") {
        return success(rpcData);
      }

      // Fallback when migration not applied yet: delete ids beyond keep window.
      const { data: keepers, error: listError } = await table()
        .select("id")
        .order("created_at", { ascending: false })
        .limit(keep);
      if (listError) return failure(mapPostgrestError(listError));

      const keepIds = new Set((keepers ?? []).map((r: { id: string }) => r.id));
      if (keepIds.size === 0) return success(0);

      // Fetch a bounded set of older candidates beyond the keep window.
      const { data: older, error: olderError } = await table()
        .select("id")
        .order("created_at", { ascending: false })
        .range(keep, keep + 2_000 - 1);
      if (olderError) return failure(mapPostgrestError(olderError));

      const toDelete = (older ?? [])
        .map((r: { id: string }) => r.id)
        .filter((id: string) => !keepIds.has(id));
      if (toDelete.length === 0) return success(0);

      const { error: delError } = await table().delete().in("id", toDelete);
      if (delError) return failure(mapPostgrestError(delError));
      return success(toDelete.length);
    },
  };
}
