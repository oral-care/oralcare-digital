-- An address outside the group may have any view an admin ticks, not only
-- Tracking Framework (plan 3.1 and 10.2, decided 2026-11-16). Dropping a check
-- only relaxes the rule, so the previous release still works against it.
ALTER TABLE "auth"."user_view" DROP CONSTRAINT "user_view_external_only_tracking";
