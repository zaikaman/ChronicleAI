-- P1-10: Expand monitored_events.event_type CHECK to match domain EventType.
-- Domain source of truth: packages/schemas/src/domain.ts (EVENT_TYPES).
-- Previously only: large_swap, liquidation, gas_spike, volume_anomaly, contract_deployment.

ALTER TABLE public.monitored_events
  DROP CONSTRAINT IF EXISTS monitored_events_event_type_check;

ALTER TABLE public.monitored_events
  ADD CONSTRAINT monitored_events_event_type_check
  CHECK (
    event_type IN (
      'large_swap',
      'liquidation',
      'liquidation_cluster',
      'gas_spike',
      'volume_anomaly',
      'contract_deployment',
      'cex_inflow',
      'cex_outflow',
      'protocol_deposit',
      'protocol_withdraw',
      'stablecoin_mint',
      'stablecoin_burn'
    )
  );

COMMENT ON CONSTRAINT monitored_events_event_type_check ON public.monitored_events IS
  'Must stay in sync with packages/schemas EventType / EVENT_TYPES.';
