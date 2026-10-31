-- A web treatment can map to several booking-system procedures at one clinic
-- (oralcare.se keeps a list of eprIds per treatment). The rule against
-- overlapping validity therefore includes the procedure id, so each procedure
-- has its own row. Expand only: the old rule is replaced, no data changes.
-- The collector from this release writes such rows, so it needs schema 2
-- (plan 7). The code before it needs 1 and keeps running.
ALTER TABLE core.treatment_epr_procedure DROP CONSTRAINT treatment_epr_procedure_no_overlap;
--> statement-breakpoint
ALTER TABLE core.treatment_epr_procedure
  ADD CONSTRAINT treatment_epr_procedure_no_overlap
  EXCLUDE USING gist (clinic_id extensions.gist_int4_ops WITH =, treatment_id extensions.gist_int4_ops WITH =,
    source_system_id extensions.gist_int2_ops WITH =, procedure_id extensions.gist_text_ops WITH =, valid_during WITH &&);
--> statement-breakpoint
UPDATE core.schema_state SET schema_version = 2;
