-- P1-4: Indexes for hot activity / feed query patterns.
-- Aligns with list + window filters used by agent activity, treasury, and execution trails.

-- monitored_events: status filters + captured_at windows (listInWindow, qualification counts)
CREATE INDEX IF NOT EXISTS idx_monitored_events_status_created_at
  ON public.monitored_events (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_monitored_events_captured_at
  ON public.monitored_events (captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_monitored_events_event_type_chain_captured
  ON public.monitored_events (event_type, chain_id, captured_at DESC);

-- treasury_snapshots: always ordered by captured_at for latest health panel
CREATE INDEX IF NOT EXISTS idx_treasury_snapshots_captured_at
  ON public.treasury_snapshots (captured_at DESC);

-- execution_logs: activity feed sorts by created_at (existing index is started_at)
CREATE INDEX IF NOT EXISTS idx_execution_logs_created_at
  ON public.execution_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_logs_action_created_at
  ON public.execution_logs (action_type, created_at DESC);

-- public_alerts / daily_digests: activity + home feeds order by created_at
-- (existing indexes cover published_at only)
CREATE INDEX IF NOT EXISTS idx_public_alerts_created_at
  ON public.public_alerts (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_daily_digests_created_at
  ON public.daily_digests (created_at DESC);
