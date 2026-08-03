// Desk capital move repository: top-ups, sweeps, emergency returns

import type { DeskCapitalDirection } from "@chronicleai/schemas";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Result, failure, success } from "./errors.ts";
import {
  buildPaginatedResult,
  mapPostgrestError,
  maybeRow,
  normalizePagination,
  type PaginatedResult,
  type PaginationParams,
} from "./repository-utils.ts";
import type {
  DeskCapitalMoveInsert,
  DeskCapitalMoveRow,
  DeskCapitalMoveUpdate,
} from "./types.ts";

export interface DeskCapitalMoveRepository {
  create(data: DeskCapitalMoveInsert): Promise<Result<DeskCapitalMoveRow>>;
  update(id: string, updates: DeskCapitalMoveUpdate): Promise<Result<DeskCapitalMoveRow>>;
  findById(id: string): Promise<Result<DeskCapitalMoveRow | null>>;
  /** Find an existing move by its funding transaction hash. */
  findByTxHash?(txHash: string): Promise<Result<DeskCapitalMoveRow | null>>;
  findLatestByDirection(
    direction: DeskCapitalDirection,
  ): Promise<Result<DeskCapitalMoveRow | null>>;
  listRecent(limitParam?: number): Promise<Result<DeskCapitalMoveRow[]>>;
  listPage(params?: PaginationParams): Promise<Result<PaginatedResult<DeskCapitalMoveRow>>>;
  listByDirection(
    direction: DeskCapitalDirection,
    limitParam?: number,
  ): Promise<Result<DeskCapitalMoveRow[]>>;
}

export function createDeskCapitalMoveRepository(
  supabase: SupabaseClient,
): DeskCapitalMoveRepository {
  const table = () => supabase.from("desk_capital_moves");

  return {
    async create(data) {
      const payload = {
        direction: data.direction,
        amount_usdc: data.amount_usdc,
        from_address: data.from_address.toLowerCase(),
        to_address: data.to_address.toLowerCase(),
        tx_hash: data.tx_hash ?? null,
        explorer_url: data.explorer_url ?? null,
        reason: data.reason ?? null,
        treasury_usdc_after: data.treasury_usdc_after ?? null,
        desk_equity_after: data.desk_equity_after ?? null,
        registry_tx_hash: data.registry_tx_hash ?? null,
        keeper_hub_run_id: data.keeper_hub_run_id ?? null,
        registry_explorer_url: data.registry_explorer_url ?? null,
        created_at: new Date().toISOString(),
      };

      const { data: row, error } = await table().insert(payload).select().single();

      if (error) return failure(mapPostgrestError(error));
      return success(row as unknown as DeskCapitalMoveRow);
    },

    async update(id, updates) {
      const payload: Record<string, unknown> = {};
      if (updates.tx_hash !== undefined) payload.tx_hash = updates.tx_hash;
      if (updates.explorer_url !== undefined) payload.explorer_url = updates.explorer_url;
      if (updates.reason !== undefined) payload.reason = updates.reason;
      if (updates.treasury_usdc_after !== undefined) {
        payload.treasury_usdc_after = updates.treasury_usdc_after;
      }
      if (updates.desk_equity_after !== undefined) {
        payload.desk_equity_after = updates.desk_equity_after;
      }
      if (updates.registry_tx_hash !== undefined) {
        payload.registry_tx_hash = updates.registry_tx_hash;
      }
      if (updates.keeper_hub_run_id !== undefined) {
        payload.keeper_hub_run_id = updates.keeper_hub_run_id;
      }
      if (updates.registry_explorer_url !== undefined) {
        payload.registry_explorer_url = updates.registry_explorer_url;
      }

      const { data: row, error } = await table().update(payload).eq("id", id).select().single();

      if (error) return failure(mapPostgrestError(error));
      return success(row as unknown as DeskCapitalMoveRow);
    },

    async findById(id) {
      const { data, error } = await table().select("*").eq("id", id).limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow((data ?? []) as DeskCapitalMoveRow[]));
    },

    async findByTxHash(txHash) {
      const { data, error } = await table().select("*").eq("tx_hash", txHash).limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow((data ?? []) as DeskCapitalMoveRow[]));
    },

    async findLatestByDirection(direction) {
      const { data, error } = await table()
        .select("*")
        .eq("direction", direction)
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow((data ?? []) as DeskCapitalMoveRow[]));
    },

    async listRecent(limitParam = 50) {
      const limit = Math.min(200, Math.max(1, limitParam));

      const { data, error } = await table()
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) return failure(mapPostgrestError(error));
      return success((data ?? []) as DeskCapitalMoveRow[]);
    },

    async listPage(params) {
      const { page, limit, offset } = normalizePagination(params, {
        defaultLimit: 15,
        maxLimit: 100,
      });

      const { data, error, count } = await table()
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) return failure(mapPostgrestError(error));
      const items = (data ?? []) as DeskCapitalMoveRow[];
      return success(buildPaginatedResult(items, page, limit, count ?? items.length));
    },

    async listByDirection(direction, limitParam = 50) {
      const limit = Math.min(200, Math.max(1, limitParam));

      const { data, error } = await table()
        .select("*")
        .eq("direction", direction)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) return failure(mapPostgrestError(error));
      return success((data ?? []) as DeskCapitalMoveRow[]);
    },
  };
}
