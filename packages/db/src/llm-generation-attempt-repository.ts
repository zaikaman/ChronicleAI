// LLM generation attempt repository: create and list by entity

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type LLMGenerationAttemptInsert,
  type LLMGenerationAttemptRow,
} from "./types.ts";
import {
  type Result,
  success,
  failure,
} from "./errors.ts";
import {
  buildInsertPayload,
  mapPostgrestError,
} from "./repository-utils.ts";

export interface LLMGenerationAttemptRepository {
  create(data: LLMGenerationAttemptInsert): Promise<Result<LLMGenerationAttemptRow>>;
  listByMonitoredEvent(eventId: string): Promise<Result<LLMGenerationAttemptRow[]>>;
  listByEntity(entityType: string, entityId: string): Promise<Result<LLMGenerationAttemptRow[]>>;
}

export function createLLMGenerationAttemptRepository(
  supabase: SupabaseClient,
): LLMGenerationAttemptRepository {
  const table = () => supabase.from("llm_generation_attempts");

  return {
    async create(data) {
      const payload = buildInsertPayload(data as unknown as Record<string, unknown>);
      const { data: rows, error } = await table()
        .insert(payload)
        .select()
        .single();

      if (error) {
        return failure(mapPostgrestError(error));
      }

      return success(rows as unknown as LLMGenerationAttemptRow);
    },

    async listByMonitoredEvent(eventId) {
      const { data: rows, error } = await table()
        .select("*")
        .eq("monitored_event_id", eventId)
        .order("attempt_order", { ascending: true });

      if (error) {
        return failure(mapPostgrestError(error));
      }

      return success(rows as unknown as LLMGenerationAttemptRow[]);
    },

    async listByEntity(entityType, entityId) {
      const { data: rows, error } = await table()
        .select("*")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .order("attempt_order", { ascending: true });

      if (error) {
        return failure(mapPostgrestError(error));
      }

      return success(rows as unknown as LLMGenerationAttemptRow[]);
    },
  };
}
