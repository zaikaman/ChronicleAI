-- P2-9: Retention helpers for unbounded desk_heartbeats / desk_positions growth.
-- Keep latest N rows (by created_at / as_of); delete the rest.
-- Application may also prune by age via repository methods.

CREATE OR REPLACE FUNCTION public.prune_desk_heartbeats(keep_count integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count integer;
BEGIN
  IF keep_count IS NULL OR keep_count < 1 THEN
    keep_count := 500;
  END IF;

  WITH keepers AS (
    SELECT id
    FROM public.desk_heartbeats
    ORDER BY created_at DESC
    LIMIT keep_count
  ),
  doomed AS (
    DELETE FROM public.desk_heartbeats d
    WHERE NOT EXISTS (SELECT 1 FROM keepers k WHERE k.id = d.id)
    RETURNING d.id
  )
  SELECT count(*)::integer INTO deleted_count FROM doomed;

  RETURN deleted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.prune_desk_positions(keep_count integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count integer;
BEGIN
  IF keep_count IS NULL OR keep_count < 1 THEN
    keep_count := 500;
  END IF;

  WITH keepers AS (
    SELECT id
    FROM public.desk_positions
    ORDER BY as_of DESC
    LIMIT keep_count
  ),
  doomed AS (
    DELETE FROM public.desk_positions d
    WHERE NOT EXISTS (SELECT 1 FROM keepers k WHERE k.id = d.id)
    RETURNING d.id
  )
  SELECT count(*)::integer INTO deleted_count FROM doomed;

  RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION public.prune_desk_heartbeats(integer) IS
  'P2-9: retain latest keep_count desk_heartbeats; delete older rows.';
COMMENT ON FUNCTION public.prune_desk_positions(integer) IS
  'P2-9: retain latest keep_count desk_positions; delete older rows.';
