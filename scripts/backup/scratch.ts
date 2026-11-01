import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { Client } from "pg";

import { runMigrations } from "../migrate";

// An empty copy of the database for checking a backup in backup.yml (plan
// 16.2): the roles as Neon has them, every migration, and then no rows, so
// the backup is read in with the real constraints and rights. Takes the
// superuser address of the job's own Postgres and prints the address of the
// new database. The passwords are random and live only in this job.

const DATABASE = "oralcare_digital";
const ROLES = ["oc_migrator", "oc_collector", "oc_app", "oc_backup"] as const;

async function main(): Promise<void> {
  const admin = process.env.SCRATCH_ADMIN_URL;
  if (!admin) throw new Error("SCRATCH_ADMIN_URL is missing");
  const url = (user: string, password: string) => {
    const target = new URL(admin);
    target.username = user;
    target.password = password;
    target.pathname = `/${DATABASE}`;
    return target.toString();
  };

  const server = new Client({ connectionString: admin });
  await server.connect();
  await server.query(`CREATE DATABASE ${DATABASE}`);
  await server.end();

  const passwords = Object.fromEntries(ROLES.map((role) => [role, randomBytes(24).toString("hex")]));
  let script = await readFile(path.resolve("scripts/sql/create-roles.sql"), "utf8");
  for (const role of ROLES) script = script.replace(`<<PASSWORD ${role}>>`, passwords[role]!);
  const owner = new Client({
    connectionString: url(new URL(admin).username, decodeURIComponent(new URL(admin).password)),
  });
  await owner.connect();
  await owner.query(script);
  await owner.end();

  await runMigrations(url("oc_migrator", passwords.oc_migrator!));

  // The migrations seed a few tables; the backup brings its own rows.
  const migrator = new Client({ connectionString: url("oc_migrator", passwords.oc_migrator!) });
  await migrator.connect();
  const tables = await migrator.query<{ name: string }>(
    `SELECT format('%I.%I', schemaname, tablename) AS name FROM pg_catalog.pg_tables
     WHERE schemaname IN ('core', 'availability')`,
  );
  await migrator.query(`TRUNCATE ${tables.rows.map((t) => t.name).join(", ")} CASCADE`);
  await migrator.end();

  process.stdout.write(url("oc_migrator", passwords.oc_migrator!));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Setting up the scratch database failed");
  process.exit(1);
});
