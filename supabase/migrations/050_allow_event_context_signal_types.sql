-- Allow public-alert projections for non-executable event context.
-- These signal types are persisted on the Sepolia desk chain for provenance
-- and desk context only; policy classification must keep them non-trading.

ALTER TABLE public.desk_signals
  DROP CONSTRAINT IF EXISTS desk_signals_signal_type_check,
  ADD CONSTRAINT desk_signals_signal_type_check
    CHECK (signal_type IN (
      'health_factor',
      'apy_delta',
      'oracle_basis',
      'gas_regime',
      'liquidation_cluster',
      'event_flow',
      'event_supply',
      'event_protocol_flow',
      'capital_tick',
      'manual'
    ));

COMMENT ON CONSTRAINT desk_signals_signal_type_check ON public.desk_signals IS
  'Desk signal families, including non-executable alert context projections.';
