-- One-time setup of the database roles (plan 10.4). Run once in Neon's SQL
-- Editor, connected to the database oralcare_digital as neondb_owner.
--
-- Before running: replace the four <<PASSWORD ...>> placeholders in the editor
-- with passwords of at least 128 bits of randomness from your password manager.
-- Never write the passwords into this file.
--
-- Roles are always created with SQL here, never on Neon's Roles page: roles
-- created there become members of neon_superuser and can read and write all.

CREATE ROLE oc_migrator LOGIN PASSWORD '<<PASSWORD oc_migrator>>';
CREATE ROLE oc_collector LOGIN PASSWORD '<<PASSWORD oc_collector>>';
CREATE ROLE oc_app LOGIN PASSWORD '<<PASSWORD oc_app>>';
CREATE ROLE oc_backup LOGIN PASSWORD '<<PASSWORD oc_backup>>';

-- Nobody connects or creates temporary tables unless listed here.
REVOKE CONNECT, TEMPORARY ON DATABASE oralcare_digital FROM PUBLIC;
GRANT CONNECT ON DATABASE oralcare_digital TO oc_migrator, oc_collector, oc_app, oc_backup;

-- The migrator creates and owns the schemas core, auth, availability and the
-- migration log schema drizzle.
GRANT CREATE ON DATABASE oralcare_digital TO oc_migrator;

-- The public schema is not used.
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- btree_gist for the exclusion constraints on validity periods, in its own
-- schema so that public stays closed.
CREATE SCHEMA extensions;
CREATE EXTENSION btree_gist WITH SCHEMA extensions;
REVOKE ALL ON SCHEMA extensions FROM PUBLIC;
GRANT USAGE ON SCHEMA extensions TO oc_migrator;

-- The roles' connections time out instead of hanging (plan 10.5).
ALTER ROLE oc_collector SET statement_timeout = '60s';
ALTER ROLE oc_app SET statement_timeout = '30s';
ALTER ROLE oc_backup SET statement_timeout = '0';
ALTER ROLE oc_migrator SET lock_timeout = '5s';
ALTER ROLE oc_migrator SET statement_timeout = '60s';
