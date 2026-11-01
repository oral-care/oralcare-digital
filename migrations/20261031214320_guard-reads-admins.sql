-- The guard sends the daily summary as oc_app. It reads the admins' addresses
-- through the same function as the collector, which already leaves out
-- suppressed addresses, and marks alerts as sent in the summary (plan 8.2).
-- oc_app can already read auth, so this adds no access to data.
GRANT EXECUTE ON FUNCTION core.admin_emails() TO oc_app;
--> statement-breakpoint
GRANT UPDATE (sent_with) ON core.alert TO oc_collector, oc_app;
--> statement-breakpoint
-- The alert sending from this release needs the column and the grants (plan 7).
UPDATE core.schema_state SET schema_version = 3;
