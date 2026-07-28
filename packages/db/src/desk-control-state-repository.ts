// Desk control-state repository: singleton kill switch + pause (survives restarts)

import type { SupabaseClient } from "@supabase/supabase-js";
import { type Result, failure, success } from "./errors.ts";
import { mapPostgrestError, maybeRow } from "./repository-utils.ts";
import {
  DESK_CONTROL_STATE_ID,
  type DeskControlStateRow,
  type DeskControlStateUpsert,
} from "./types.ts";

export interface DeskControlStateRepository {
  /** Load the singleton control row (creates defaults if missing). */
  get(): Promise<Result<DeskControlStateRow>>;
  /** Upsert the singleton control row. Partial fields merge with current. */
  upsert(patch: DeskControlStateUpsert): Promise<Result<DeskControlStateRow>>;
}

const EMPTY: DeskControlStateRow = {
  id: DESK_CONTROL_STATE_ID,
  kill_armed: false,
  kill_armed_at: null,
  kill_armed_reason: null,
  last_trip_at: null,
  last_trip_reason: null,
  last_keeper_hub_run_id: null,
  last_tx_hash: null,
  desk_paused: false,
  last_maintenance_at: null,
  last_event_microtrade_at: null,
  updated_at: new Date(0).toISOString(),
};

export function createDeskControlStateRepository(
  supabase: SupabaseClient,
): DeskControlStateRepository {
  const table = () => supabase.from("desk_control_state");

  return {
    async get() {
      const { data, error } = await table()
        .select("*")
        .eq("id", DESK_CONTROL_STATE_ID)
        .limit(1);

      if (error) return failure(mapPostgrestError(error));
      const row = maybeRow((data ?? []) as DeskControlStateRow[]);
      if (row) return success(row);

      // Ensure singleton exists so subsequent upserts have a stable base.
      const { data: inserted, error: insertError } = await table()
        .upsert({
          id: DESK_CONTROL_STATE_ID,
          kill_armed: false,
          desk_paused: false,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (insertError) return failure(mapPostgrestError(insertError));
      return success((inserted as DeskControlStateRow | null) ?? EMPTY);
    },

    async upsert(patch) {
      const currentResult = await this.get();
      if (!currentResult.ok) return currentResult;
      const current = currentResult.value;

      const payload = {
        id: DESK_CONTROL_STATE_ID,
        kill_armed:
          patch.kill_armed !== undefined ? patch.kill_armed : current.kill_armed,
        kill_armed_at:
          patch.kill_armed_at !== undefined
            ? patch.kill_armed_at
            : current.kill_armed_at,
        kill_armed_reason:
          patch.kill_armed_reason !== undefined
            ? patch.kill_armed_reason
            : current.kill_armed_reason,
        last_trip_at:
          patch.last_trip_at !== undefined
            ? patch.last_trip_at
            : current.last_trip_at,
        last_trip_reason:
          patch.last_trip_reason !== undefined
            ? patch.last_trip_reason
            : current.last_trip_reason,
        last_keeper_hub_run_id:
          patch.last_keeper_hub_run_id !== undefined
            ? patch.last_keeper_hub_run_id
            : current.last_keeper_hub_run_id,
        last_tx_hash:
          patch.last_tx_hash !== undefined
            ? patch.last_tx_hash
            : current.last_tx_hash,
        desk_paused:
          patch.desk_paused !== undefined
            ? patch.desk_paused
            : current.desk_paused,
        last_maintenance_at:
          patch.last_maintenance_at !== undefined
            ? patch.last_maintenance_at
            : current.last_maintenance_at ?? null,
        last_event_microtrade_at:
          patch.last_event_microtrade_at !== undefined
            ? patch.last_event_microtrade_at
            : current.last_event_microtrade_at ?? null,
        updated_at: new Date().toISOString(),
      };

      const { data: row, error } = await table()
        .upsert(payload)
        .select()
        .single();

      if (error) return failure(mapPostgrestError(error));
      return success(row as unknown as DeskControlStateRow);
    },
  };
}
