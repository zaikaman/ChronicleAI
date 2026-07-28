// Desk position repository: equity snapshots (latest + history)

import type { SupabaseClient } from "@supabase/supabase-js";
import { type Result, failure, success } from "./errors.ts";
import { mapPostgrestError, maybeRow } from "./repository-utils.ts";
import type { DeskPositionInsert, DeskPositionRow } from "./types.ts";

/** Default rows to retain after prune (P2-9). */
export const DESK_POSITION_RETAIN_COUNT = 500;

export interface DeskPositionRepository {
  create(data: DeskPositionInsert): Promise<Result<DeskPositionRow>>;
  findById(id: string): Promise<Result<DeskPositionRow | null>>;
  findLatest(deskAddress?: string): Promise<Result<DeskPositionRow | null>>;
  listRecent(limitParam?: number, deskAddress?: string): Promise<Result<DeskPositionRow[]>>;
  /**
   * P2-9: keep latest `keepCount` positions; delete older.
   * Prefers RPC `prune_desk_positions`; falls back to client-side delete.
   */
  pruneKeepLatest(keepCount?: number): Promise<Result<number>>;
}

export function createDeskPositionRepository(
  supabase: SupabaseClient,
): DeskPositionRepository {
  const table = () => supabase.from("desk_positions");

  return {
    async create(data) {
      const payload = {
        as_of: data.as_of,
        desk_address: data.desk_address.toLowerCase(),
        usdc: data.usdc ?? 0,
        weth: data.weth ?? 0,
        link: data.link ?? 0,
        aave: data.aave ?? {},
        morpho: data.morpho ?? null,
        lido: data.lido ?? null,
        equity_usdc: data.equity_usdc ?? 0,
        raw: data.raw ?? {},
        created_at: new Date().toISOString(),
      };

      const { data: row, error } = await table().insert(payload).select().single();

      if (error) return failure(mapPostgrestError(error));
      return success(row as unknown as DeskPositionRow);
    },

    async findById(id) {
      const { data, error } = await table().select("*").eq("id", id).limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow((data ?? []) as DeskPositionRow[]));
    },

    async findLatest(deskAddress?) {
      let query = table().select("*").order("as_of", { ascending: false }).limit(1);

      if (deskAddress) {
        query = query.eq("desk_address", deskAddress.toLowerCase());
      }

      const { data, error } = await query;

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow((data ?? []) as DeskPositionRow[]));
    },

    async listRecent(limitParam = 50, deskAddress?) {
      const limit = Math.min(200, Math.max(1, limitParam));

      let query = table()
        .select("*")
        .order("as_of", { ascending: false })
        .limit(limit);

      if (deskAddress) {
        query = query.eq("desk_address", deskAddress.toLowerCase());
      }

      const { data, error } = await query;

      if (error) return failure(mapPostgrestError(error));
      return success((data ?? []) as DeskPositionRow[]);
    },

    async pruneKeepLatest(keepCount = DESK_POSITION_RETAIN_COUNT) {
      const keep = Math.min(5_000, Math.max(1, keepCount));

      const { data: rpcData, error: rpcError } = await supabase.rpc(
        "prune_desk_positions",
        { keep_count: keep },
      );
      if (!rpcError && typeof rpcData === "number") {
        return success(rpcData);
      }

      const { data: keepers, error: listError } = await table()
        .select("id")
        .order("as_of", { ascending: false })
        .limit(keep);
      if (listError) return failure(mapPostgrestError(listError));

      const keepIds = new Set((keepers ?? []).map((r: { id: string }) => r.id));
      if (keepIds.size === 0) return success(0);

      const { data: older, error: olderError } = await table()
        .select("id")
        .order("as_of", { ascending: false })
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
