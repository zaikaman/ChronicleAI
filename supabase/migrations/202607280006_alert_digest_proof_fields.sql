-- IDEA demo proof packaging: content hash + gas used on publication receipts.
-- Dashboard surfaces these on AlertCard / Activity for every anchored alert & digest.

ALTER TABLE public_alerts
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS gas_used text,
  ADD COLUMN IF NOT EXISTS gas_used_wei text;

ALTER TABLE daily_digests
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS gas_used text,
  ADD COLUMN IF NOT EXISTS gas_used_wei text;

COMMENT ON COLUMN public_alerts.content_hash IS
  'bytes32 content hash written to Chronicle Registry (keccak of published alert body)';
COMMENT ON COLUMN public_alerts.gas_used IS
  'Gas units consumed by the registry publishAlert transaction (decimal string)';
COMMENT ON COLUMN public_alerts.gas_used_wei IS
  'Total gas cost in wei when reported by KeeperHub (decimal string)';

COMMENT ON COLUMN daily_digests.content_hash IS
  'bytes32 content hash written to Chronicle Registry (keccak of published digest body)';
COMMENT ON COLUMN daily_digests.gas_used IS
  'Gas units consumed by the registry publishDigest transaction (decimal string)';
COMMENT ON COLUMN daily_digests.gas_used_wei IS
  'Total gas cost in wei when reported by KeeperHub (decimal string)';
