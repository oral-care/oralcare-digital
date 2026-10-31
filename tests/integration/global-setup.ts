import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";
import type { TestProject } from "vitest/node";

import { runMigrations } from "../../scripts/migrate";

// A fresh Postgres for every integration run: the role script as Neon's owner
// would run it, then every migration as oc_migrator (plan 15.2). The same
// embedded Postgres runs locally and in CI.

const PORT = 54329;
const ROLES = ["oc_migrator", "oc_collector", "oc_app", "oc_backup"] as const;
export type RoleName = (typeof ROLES)[number];

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrls: Record<RoleName | "owner", string>;
  }
}

export default async function setup(project: TestProject) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "oralcare-digital-pg-"));
  const postgres = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port: PORT,
    persistent: false,
    onLog: () => undefined,
  });
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase("oralcare_digital");

  const url = (user: string, password: string) =>
    `postgresql://${user}:${password}@localhost:${PORT}/oralcare_digital`;
  const owner = url("postgres", "postgres");
  const urls = Object.fromEntries(ROLES.map((role) => [role, url(role, `test-${role}`)])) as Record<
    RoleName,
    string
  >;

  // Test passwords stand in for the placeholders, as Emma does in the SQL Editor.
  let script = await readFile(path.resolve("scripts/sql/create-roles.sql"), "utf8");
  for (const role of ROLES) script = script.replace(`<<PASSWORD ${role}>>`, `test-${role}`);
  const client = new Client({ connectionString: owner });
  await client.connect();
  await client.query(script);
  await client.end();

  await runMigrations(urls.oc_migrator);
  project.provide("databaseUrls", { ...urls, owner });

  return async () => {
    await postgres.stop();
    await rm(dataDir, { recursive: true, force: true });
  };
}
