// System control-state repository: singleton system state (Groq key rotation index)
// Survives API process restarts.

import type { SupabaseClient } from "@supabase/supabase-js";
import { type Result, failure, success } from "./errors.ts";
import { mapPostgrestError, maybeRow } from "./repository-utils.ts";
import {
  SYSTEM_CONTROL_STATE_ID,
  type SystemControlStateRow,
  type SystemControlStateUpsert,
} from "./types.ts";

export interface SystemControlStateRepository {
  /** Load the singleton system control row (creates defaults if missing). */
  get(): Promise<Result<SystemControlStateRow>>;
  /** Upsert the singleton system control row. Partial fields merge with current. */
  upsert(patch: SystemControlStateUpsert): Promise<Result<SystemControlStateRow>>;
}

const EMPTY: SystemControlStateRow = {
  id: SYSTEM_CONTROL_STATE_ID,
  groq_key_index: 0,
  updated_at: new Date(0).toISOString(),
};

export function createSystemControlStateRepository(
  supabase: SupabaseClient,
): SystemControlStateRepository {
  const table = () => supabase.from("system_control_state");

  return {
    async get() {
      const { data, error } = await table()
        .select("*")
        .eq("id", SYSTEM_CONTROL_STATE_ID)
        .limit(1);

      if (error) return failure(mapPostgrestError(error));
      const row = maybeRow((data ?? []) as SystemControlStateRow[]);
      if (row) return success(row);

      // Ensure singleton exists so subsequent upserts have a stable base.
      const { data: inserted, error: insertError } = await table()
        .upsert({
          id: SYSTEM_CONTROL_STATE_ID,
          groq_key_index: 0,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (insertError) return failure(mapPostgrestError(insertError));
      return success((inserted as SystemControlStateRow | null) ?? EMPTY);
    },

    async upsert(patch) {
      const currentResult = await this.get();
      if (!currentResult.ok) return currentResult;
      const current = currentResult.value;

      const payload = {
        id: SYSTEM_CONTROL_STATE_ID,
        groq_key_index:
          patch.groq_key_index !== undefined
            ? patch.groq_key_index
            : current.groq_key_index,
        updated_at: new Date().toISOString(),
      };

      const { data: row, error } = await table()
        .upsert(payload)
        .select()
        .single();

      if (error) return failure(mapPostgrestError(error));
      return success(row as unknown as SystemControlStateRow);
    },
  };
}
