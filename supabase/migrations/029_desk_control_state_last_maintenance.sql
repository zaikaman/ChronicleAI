-- A2: O(1) maintenance rebalance cadence (edge-independent free-powder).
ALTER TABLE public.desk_control_state
  ADD COLUMN IF NOT EXISTS last_maintenance_at TIMESTAMPTZ;

COMMENT ON COLUMN public.desk_control_state.last_maintenance_at IS
  'Timestamp of last successful yield_rotation maintenance fill (free powder / rebalance). Used for DESK_REBALANCE_INTERVAL_MS cadence.';
