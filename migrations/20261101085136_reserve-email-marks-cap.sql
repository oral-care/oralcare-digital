-- core.reserve_email also notes when the cap first refuses a reservation of the
-- UTC day and type, in core.email_send.capped_at (plan 8.2 and 11). The
-- reservation is still one statement, so two concurrent sends can never both
-- take the last place: RETURNING old and new (PostgreSQL 18) tells whether this
-- statement added to the count. Same signature, owner and grants as before.
CREATE OR REPLACE FUNCTION core.reserve_email(p_type text, p_count integer DEFAULT 1)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  cap integer := CASE p_type
    WHEN 'sign-in' THEN 60
    WHEN 'invitation' THEN 10
    WHEN 'alert' THEN 15
    WHEN 'summary' THEN 5
    ELSE 0
  END;
  today date := (pg_catalog.now() AT TIME ZONE 'UTC')::date;
  before_count integer;
  after_count integer;
BEGIN
  IF p_count IS NULL OR p_count < 1 OR cap = 0 THEN
    RETURN false;
  END IF;
  IF p_count > cap THEN
    INSERT INTO core.email_send AS e (utc_day, type, count, capped_at)
    VALUES (today, p_type, 0, pg_catalog.now())
    ON CONFLICT (utc_day, type) DO UPDATE SET capped_at = coalesce(e.capped_at, excluded.capped_at);
    RETURN false;
  END IF;
  INSERT INTO core.email_send AS e (utc_day, type, count)
  VALUES (today, p_type, p_count)
  ON CONFLICT (utc_day, type) DO UPDATE
    SET count = CASE WHEN e.count + excluded.count <= cap THEN e.count + excluded.count ELSE e.count END,
        capped_at = CASE WHEN e.count + excluded.count <= cap THEN e.capped_at
                         ELSE coalesce(e.capped_at, pg_catalog.now()) END
  RETURNING old.count, new.count INTO before_count, after_count;
  RETURN before_count IS NULL OR after_count > before_count;
END;
$$;
--> statement-breakpoint
-- The guard from this release reads capped_at (plan 7).
UPDATE core.schema_state SET schema_version = 4;
