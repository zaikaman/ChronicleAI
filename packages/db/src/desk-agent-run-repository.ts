// Desk agent run repository: audit trail for LLM proposals

import type { SupabaseClient } from "@supabase/supabase-js";
import { type Result, failure, success } from "./errors.ts";
import {
  buildInsertPayload,
  buildUpdatePayload,
  mapPostgrestError,
  maybeRow,
} from "./repository-utils.ts";
import type {
  DeskAgentRunInsert,
  DeskAgentRunRow,
  DeskAgentRunUpdate,
} from "./types.ts";

export interface DeskAgentRunRepository {
  create(data: DeskAgentRunInsert): Promise<Result<DeskAgentRunRow>>;
  findById(id: string): Promise<Result<DeskAgentRunRow | null>>;
  update(id: string, update: DeskAgentRunUpdate): Promise<Result<DeskAgentRunRow>>;
  listRecent(limitParam?: number): Promise<Result<DeskAgentRunRow[]>>;
  findLatest(): Promise<Result<DeskAgentRunRow | null>>;
  linkIntent(id: string, intentId: string): Promise<Result<DeskAgentRunRow>>;
}

export function createDeskAgentRunRepository(
  supabase: SupabaseClient,
): DeskAgentRunRepository {
  const table = () => supabase.from("desk_agent_runs");

  return {
    async create(data) {
      // desk_agent_runs is append-only (created_at only; no updated_at).
      const payload = buildInsertPayload(
        {
          model: data.model ?? null,
          latency_ms: data.latency_ms ?? null,
          proposal: data.proposal ?? {},
          context_digest: data.context_digest ?? {},
          intent_id: data.intent_id ?? null,
          error_message: data.error_message ?? null,
        } as unknown as Record<string, unknown>,
        {
          updated_at: false,
          ...(data.created_at !== undefined ? { created_at: data.created_at } : {}),
        },
      );

      const { data: row, error } = await table().insert(payload).select().single();

      if (error) return failure(mapPostgrestError(error));
      return success(row as unknown as DeskAgentRunRow);
    },

    async findById(id) {
      const { data, error } = await table().select("*").eq("id", id).limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow((data ?? []) as DeskAgentRunRow[]));
    },

    async update(id, update) {
      // desk_agent_runs has no updated_at column.
      const payload = buildUpdatePayload(update as unknown as Record<string, unknown>, {
        includeUpdatedAt: false,
      });
      const { data: row, error } = await table()
        .update(payload)
        .eq("id", id)
        .select()
        .single();

      if (error) return failure(mapPostgrestError(error));
      return success(row as unknown as DeskAgentRunRow);
    },

    async listRecent(limitParam = 20) {
      const limit = Math.min(100, Math.max(1, limitParam));
      const { data, error } = await table()
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) return failure(mapPostgrestError(error));
      return success((data ?? []) as DeskAgentRunRow[]);
    },

    async findLatest() {
      const { data, error } = await table()
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow((data ?? []) as DeskAgentRunRow[]));
    },

    async linkIntent(id, intentId) {
      return this.update(id, { intent_id: intentId });
    },
  };
}
