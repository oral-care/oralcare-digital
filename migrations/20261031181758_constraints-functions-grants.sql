-- Everything Drizzle Kit can't express (plan 10.5): exclusion constraints on the
-- validity periods, the security definer functions, the grants for each role,
-- the start values and the schema version. Runs as oc_migrator, which owns the
-- schemas. btree_gist lives in the schema "extensions" (scripts/sql/create-roles.sql),
-- so its operator classes are schema-qualified here.

-- Validity periods may never overlap (plan 10.1).
ALTER TABLE core.clinic_name
  ADD CONSTRAINT clinic_name_no_overlap
  EXCLUDE USING gist (clinic_id extensions.gist_int4_ops WITH =, valid_during WITH &&);
--> statement-breakpoint
ALTER TABLE core.clinic_external_id
  ADD CONSTRAINT clinic_external_id_clinic_no_overlap
  EXCLUDE USING gist (clinic_id extensions.gist_int4_ops WITH =, source_system_id extensions.gist_int2_ops WITH =, valid_during WITH &&);
--> statement-breakpoint
ALTER TABLE core.clinic_external_id
  ADD CONSTRAINT clinic_external_id_value_no_overlap
  EXCLUDE USING gist (source_system_id extensions.gist_int2_ops WITH =, external_id extensions.gist_text_ops WITH =, valid_during WITH &&);
--> statement-breakpoint
ALTER TABLE core.clinic_region
  ADD CONSTRAINT clinic_region_no_overlap
  EXCLUDE USING gist (clinic_id extensions.gist_int4_ops WITH =, valid_during WITH &&);
--> statement-breakpoint
ALTER TABLE core.treatment_name
  ADD CONSTRAINT treatment_name_no_overlap
  EXCLUDE USING gist (treatment_id extensions.gist_int4_ops WITH =, valid_during WITH &&);
--> statement-breakpoint
ALTER TABLE core.treatment_epr_procedure
  ADD CONSTRAINT treatment_epr_procedure_no_overlap
  EXCLUDE USING gist (clinic_id extensions.gist_int4_ops WITH =, treatment_id extensions.gist_int4_ops WITH =, source_system_id extensions.gist_int2_ops WITH =, valid_during WITH &&);
--> statement-breakpoint
ALTER TABLE core.clinic_treatment_offering
  ADD CONSTRAINT clinic_treatment_offering_no_overlap
  EXCLUDE USING gist (clinic_id extensions.gist_int4_ops WITH =, treatment_id extensions.gist_int4_ops WITH =, valid_during WITH &&);
--> statement-breakpoint

-- No function is callable by PUBLIC, now or later (plan 10.4).
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
--> statement-breakpoint

-- Reserves e-mails before sending, per UTC day and type, counted per recipient
-- as Resend counts them (plan 11). One statement, so two concurrent sends can
-- never both take the last place. Caps: 60 codes, 10 invitations, and for up to
-- 5 admins 15 alert e-mails and 5 summaries, 90 of Resend's 100 in all.
CREATE FUNCTION core.reserve_email(p_type text, p_count integer DEFAULT 1)
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
  reserved integer;
BEGIN
  IF p_count IS NULL OR p_count < 1 OR p_count > cap THEN
    RETURN false;
  END IF;
  INSERT INTO core.email_send AS e (utc_day, type, count)
  VALUES ((pg_catalog.now() AT TIME ZONE 'UTC')::date, p_type, p_count)
  ON CONFLICT (utc_day, type) DO UPDATE
    SET count = e.count + excluded.count
    WHERE e.count + excluded.count <= cap
  RETURNING count INTO reserved;
  RETURN reserved IS NOT NULL;
END;
$$;
--> statement-breakpoint

-- The collector sends alerts but may not read auth: this returns only the
-- addresses of admins that can receive mail (plan 10.4).
CREATE FUNCTION core.admin_emails()
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT u.email
  FROM auth.users u
  WHERE u.role = 'admin'
    AND NOT EXISTS (SELECT 1 FROM auth.email_suppression s WHERE s.email = u.email)
  ORDER BY u.email;
$$;
--> statement-breakpoint

-- Daily retention in batches of 5 000 rows (plan 10.4). Takes no arguments,
-- works out the limits itself and never removes measurement data newer than 90
-- days. Server errors go after 30 days, since they are not measurement data.
CREATE FUNCTION core.prune()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  batch constant integer := 5000;
  floor_age constant interval := interval '90 days';
  removed integer;
  total integer;
  result jsonb := '{}'::jsonb;
BEGIN
  total := 0;
  LOOP
    DELETE FROM availability.slot_list WHERE id IN (
      SELECT s.id FROM availability.slot_list s
      JOIN core.job_run r ON r.id = s.job_run_id
      WHERE r.started_at < pg_catalog.now() - floor_age
      LIMIT batch);
    GET DIAGNOSTICS removed = ROW_COUNT;
    total := total + removed;
    EXIT WHEN removed < batch;
  END LOOP;
  result := result || jsonb_build_object('slot_list', total);

  total := 0;
  LOOP
    DELETE FROM availability.measurement WHERE id IN (
      SELECT m.id FROM availability.measurement m
      JOIN core.job_run r ON r.id = m.job_run_id
      WHERE r.started_at < pg_catalog.now() - GREATEST(interval '25 months', floor_age)
      LIMIT batch);
    GET DIAGNOSTICS removed = ROW_COUNT;
    total := total + removed;
    EXIT WHEN removed < batch;
  END LOOP;
  result := result || jsonb_build_object('measurement', total);

  total := 0;
  LOOP
    DELETE FROM availability.comparison WHERE id IN (
      SELECT c.id FROM availability.comparison c
      JOIN core.job_run r ON r.id = c.job_run_id
      WHERE r.started_at < pg_catalog.now() - GREATEST(interval '25 months', floor_age)
      LIMIT batch);
    GET DIAGNOSTICS removed = ROW_COUNT;
    total := total + removed;
    EXIT WHEN removed < batch;
  END LOOP;
  result := result || jsonb_build_object('comparison', total);

  DELETE FROM core.app_error WHERE occurred_at < pg_catalog.now() - interval '30 days';
  GET DIAGNOSTICS removed = ROW_COUNT;
  result := result || jsonb_build_object('app_error', removed);

  DELETE FROM core.alert
  WHERE status = 'sent' AND sent_at < pg_catalog.now() - GREATEST(interval '12 months', floor_age);
  GET DIAGNOSTICS removed = ROW_COUNT;
  result := result || jsonb_build_object('alert', removed);

  RETURN result;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION core.reserve_email(text, integer), core.admin_emails(), core.prune() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION core.reserve_email(text, integer) TO oc_collector, oc_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION core.admin_emails() TO oc_collector;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION core.prune() TO oc_app;
--> statement-breakpoint

-- Grants per role (plan 10.4). Nobody but the owner gets anything by default.
REVOKE ALL ON SCHEMA core, auth, availability FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA core, availability TO oc_collector, oc_app, oc_backup;
--> statement-breakpoint
GRANT USAGE ON SCHEMA auth TO oc_app;
--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA core, availability TO oc_collector, oc_app, oc_backup;
--> statement-breakpoint
GRANT SELECT ON ALL SEQUENCES IN SCHEMA core, availability TO oc_backup;
--> statement-breakpoint

-- oc_collector: adds to the registry, run log, measurements and alerts. Changes
-- only run status, alert status, daily values and end dates. Deletes nothing.
GRANT INSERT ON core.region, core.clinic, core.clinic_name, core.clinic_external_id, core.clinic_region,
  core.treatment, core.treatment_name, core.treatment_epr_procedure, core.clinic_treatment_offering,
  core.job_run, core.alert TO oc_collector;
--> statement-breakpoint
GRANT UPDATE (valid_during) ON core.clinic_name, core.clinic_external_id, core.clinic_region,
  core.treatment_name, core.treatment_epr_procedure, core.clinic_treatment_offering TO oc_collector;
--> statement-breakpoint
GRANT UPDATE (status, attempt, started_at, finished_at, lease_until, delay_ms, window_start, schema_version,
  duration_ms, cpu_ms, request_count, error_codes, details) ON core.job_run TO oc_collector, oc_app;
--> statement-breakpoint
GRANT UPDATE (status, sent_at, attempts, last_error_code) ON core.alert TO oc_collector, oc_app;
--> statement-breakpoint
GRANT INSERT ON availability.measurement, availability.comparison, availability.slot_list, availability.daily_value,
  availability.daily_slot_list, availability.site_incident, availability.change_event TO oc_collector;
--> statement-breakpoint
GRANT UPDATE ON availability.daily_value, availability.daily_slot_list TO oc_collector;
--> statement-breakpoint

-- oc_app: the app and the guard. Reads and writes auth, writes the guard's run
-- log, alerts and server errors.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO oc_app;
--> statement-breakpoint
GRANT INSERT ON core.job_run, core.alert, core.app_error TO oc_app;
--> statement-breakpoint

-- oc_backup: reads everything outside auth and logs its own runs.
GRANT INSERT ON core.job_run TO oc_backup;
--> statement-breakpoint
GRANT UPDATE (status, finished_at, duration_ms, bytes, error_codes, details) ON core.job_run TO oc_backup;
--> statement-breakpoint

-- Start values.
INSERT INTO core.country (code, name, brand, time_zone) VALUES
  ('se', 'Sweden', 'Oral Care', 'Europe/Stockholm'),
  ('no', 'Norway', 'OC Tannklinikker', 'Europe/Oslo'),
  ('dk', 'Denmark', 'Oral Care', 'Europe/Copenhagen'),
  ('nl', 'Netherlands', 'Oral Care', 'Europe/Amsterdam');
--> statement-breakpoint
INSERT INTO core.source_system (key, role, name) VALUES
  ('oralcare_se', 'web', 'oralcare.se'),
  ('muntra', 'epr', 'Muntra');
--> statement-breakpoint
INSERT INTO core.market_source (country_id, source_system_id)
SELECT c.id, s.id FROM core.country c CROSS JOIN core.source_system s
WHERE c.code = 'se' AND s.key IN ('oralcare_se', 'muntra');
--> statement-breakpoint

-- Availability and waiting time (plan 5.2): Good is more than 10 slots in 14
-- days, Short is a first slot within 3 days, and for Akut (muntra-treatment-23)
-- the same day.
INSERT INTO availability.status_threshold_version (country_id, treatment_web_key, good_min_slots, short_max_days)
SELECT id, NULL, 11, 3 FROM core.country WHERE code = 'se'
UNION ALL
SELECT id, 'muntra-treatment-23', 11, 0 FROM core.country WHERE code = 'se';
--> statement-breakpoint

INSERT INTO core.config_version (key, value, note) VALUES
  ('incident_threshold', '0.30', 'Share of pairs with slots in Muntra but none on oralcare.se (plan 6.4)'),
  ('vercel_cpu_budget_hours', '4', 'Hobby only. Emptied at the switch to Pro (plan 16.3)'),
  ('login_paused', 'false', 'Emergency stop for sign-in codes (plan 11)'),
  ('vercel_token_expires_on', '"2027-11-01"', 'The deploy token in GitHub expires on this day (plan 20)');
--> statement-breakpoint

INSERT INTO core.schema_state (id, schema_version, min_code_schema) VALUES (true, 1, 1);
