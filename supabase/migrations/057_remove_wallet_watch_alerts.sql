-- ── Remove Wallet Watch Alerts ─────────────────────────────
-- Wallet watch alerts (event_type = 'wallet_transfer' or title starting with 'Wallet watch alert')
-- should not appear in the public Alerts database or feed.

DELETE FROM public.public_alerts
WHERE event_type = 'wallet_transfer'
   OR title LIKE 'Wallet watch alert%';
