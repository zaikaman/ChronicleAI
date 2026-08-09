// Desk ticket repository: proof-of-trade persistence

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
import type { DeskTicketInsert, DeskTicketRow, DeskTicketUpdate } from "./types.ts";

export interface DeskTicketRepository {
  create(data: DeskTicketInsert): Promise<Result<DeskTicketRow>>;
  findById(id: string): Promise<Result<DeskTicketRow | null>>;
  findByIntentId(intentId: string): Promise<Result<DeskTicketRow | null>>;
  findByTicketHash(ticketHash: string): Promise<Result<DeskTicketRow | null>>;
  /** Most recent ticket whose signal commitment hash matches. */
  findBySignalHash(signalHash: string): Promise<Result<DeskTicketRow | null>>;
  findByKeeperHubRunId(keeperHubRunId: string): Promise<Result<DeskTicketRow | null>>;
  findByTxHash(txHash: string): Promise<Result<DeskTicketRow | null>>;
  update(id: string, update: DeskTicketUpdate): Promise<Result<DeskTicketRow>>;
  listRecent(limitParam?: number): Promise<Result<DeskTicketRow[]>>;
  listPage(params?: PaginationParams): Promise<Result<PaginatedResult<DeskTicketRow>>>;
}

export function createDeskTicketRepository(
  supabase: SupabaseClient,
): DeskTicketRepository {
  const table = () => supabase.from("desk_tickets");

  return {
    async create(data) {
      const payload = {
        intent_id: data.intent_id,
        ticket_hash: data.ticket_hash.toLowerCase(),
        signal_hash: data.signal_hash?.toLowerCase() ?? null,
        intent_hash: data.intent_hash?.toLowerCase() ?? null,
        content_uri: data.content_uri ?? null,
        tx_hash: data.tx_hash ?? null,
        keeper_hub_run_id: data.keeper_hub_run_id ?? null,
        explorer_url: data.explorer_url ?? null,
        summary: data.summary ?? null,
        payload: data.payload ?? {},
        created_at: new Date().toISOString(),
      };

      const { data: row, error } = await table().insert(payload).select().single();

      if (error) return failure(mapPostgrestError(error));
      return success(row as unknown as DeskTicketRow);
    },

    async findById(id) {
      const { data, error } = await table().select("*").eq("id", id).limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow((data ?? []) as DeskTicketRow[]));
    },

    async findByIntentId(intentId) {
      const { data, error } = await table()
        .select("*")
        .eq("intent_id", intentId)
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow((data ?? []) as DeskTicketRow[]));
    },

    async findByTicketHash(ticketHash) {
      const { data, error } = await table()
        .select("*")
        .eq("ticket_hash", ticketHash.toLowerCase())
        .limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow((data ?? []) as DeskTicketRow[]));
    },

    async findBySignalHash(signalHash) {
      const { data, error } = await table()
        .select("*")
        .eq("signal_hash", signalHash.toLowerCase())
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow((data ?? []) as DeskTicketRow[]));
    },

    async findByKeeperHubRunId(keeperHubRunId) {
      const { data, error } = await table()
        .select("*")
        .eq("keeper_hub_run_id", keeperHubRunId)
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow((data ?? []) as DeskTicketRow[]));
    },

    async findByTxHash(txHash) {
      const { data, error } = await table()
        .select("*")
        .eq("tx_hash", txHash)
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow((data ?? []) as DeskTicketRow[]));
    },

    async update(id, update) {
      const payload: Record<string, unknown> = { ...update };
      if (typeof payload.ticket_hash === "string") {
        payload.ticket_hash = payload.ticket_hash.toLowerCase();
      }
      if (typeof payload.signal_hash === "string") {
        payload.signal_hash = payload.signal_hash.toLowerCase();
      }
      if (typeof payload.intent_hash === "string") {
        payload.intent_hash = payload.intent_hash.toLowerCase();
      }

      const { data: row, error } = await table()
        .update(payload)
        .eq("id", id)
        .select()
        .single();

      if (error) return failure(mapPostgrestError(error));
      return success(row as unknown as DeskTicketRow);
    },

    async listRecent(limitParam = 50) {
      const limit = Math.min(200, Math.max(1, limitParam));

      const { data, error } = await table()
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) return failure(mapPostgrestError(error));
      return success((data ?? []) as DeskTicketRow[]);
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
      const items = (data ?? []) as DeskTicketRow[];
      return success(buildPaginatedResult(items, page, limit, count ?? items.length));
    },
  };
}
