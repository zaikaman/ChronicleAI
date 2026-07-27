// Execution log repository: append logs and list by entity

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type ExecutionLogInsert,
  type ExecutionLogRow,
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

export interface ExecutionLogRepository {
  append(data: ExecutionLogInsert): Promise<Result<ExecutionLogRow>>;
  listByEntity(
    entityType: string,
    entityId: string,
    limitParam?: number,
  ): Promise<Result<ExecutionLogRow[]>>;
  listRecent(
    limitParam?: number,
  ): Promise<Result<ExecutionLogRow[]>>;
}

export function createExecutionLogRepository(
  supabase: SupabaseClient,
): ExecutionLogRepository {
  const table = () => supabase.from("execution_logs");

  return {
    async append(data) {
      const payload = buildInsertPayload(data as unknown as Record<string, unknown>);
      const { data: rows, error } = await table()
        .insert(payload)
        .select()
        .single();

      if (error) {
        return failure(mapPostgrestError(error));
      }

      return success(rows as unknown as ExecutionLogRow);
    },

    async listByEntity(entityType, entityId, limitParam = 50) {
      const limit = Math.min(100, Math.max(1, limitParam));

      const { data: rows, error } = await table()
        .select("*")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        return failure(mapPostgrestError(error));
      }

      return success(rows as unknown as ExecutionLogRow[]);
    },

    async listRecent(limitParam = 100) {
      const limit = Math.min(200, Math.max(1, limitParam));

      const { data: rows, error } = await table()
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        return failure(mapPostgrestError(error));
      }

      return success(rows as unknown as ExecutionLogRow[]);
    },
  };
}
