# The tables a backup holds (plan 16.2), shared by backup.sh and restore.sh.
# auth is never backed up: after a restore, an admin invites the users again.

# Small tables that change, copied whole every night, parents before children.
SMALL_TABLES=(
  core.country
  core.source_system
  core.market_source
  core.region
  core.clinic
  core.clinic_name
  core.clinic_external_id
  core.clinic_region
  core.treatment
  core.treatment_name
  core.treatment_epr_procedure
  core.clinic_treatment_offering
  core.job_run
  core.schema_state
  core.config_version
  core.alert
  core.email_send
  core.app_error
  availability.status_threshold_version
  availability.site_incident
  availability.change_event
)

# Tables that only grow, copied from the last backup's highest id. Their key
# column is after the colon. Daily values are written once, at the day's point.
APPEND_TABLES=(
  availability.measurement:id
  availability.comparison:id
  availability.slot_list:id
  availability.daily_value:id
  availability.daily_slot_list:daily_value_id
)

# Plain COPY leaves identity sequences behind; this sets them past the rows read in.
IDENTITY_SQL="DO \$\$ DECLARE r record; BEGIN
  FOR r IN SELECT format('%I.%I', n.nspname, c.relname) AS t, a.attname AS col
           FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname IN ('core', 'availability') AND a.attidentity <> '' LOOP
    EXECUTE format('SELECT setval(pg_get_serial_sequence(%L, %L), greatest(1, (SELECT coalesce(max(%I), 0) FROM %s)))',
                   r.t, r.col, r.col, r.t);
  END LOOP; END \$\$"
