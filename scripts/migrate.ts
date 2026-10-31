import { pathToFileURL } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

import { databaseUrl } from "../src/lib/env";

// Runs the migrations as oc_migrator against Neon's non-pooled address (plan
// 10.5). Used by the migrate job in deploy.yml and by the integration tests.
// Every session gets short lock and statement timeouts, so a migration never
// blocks the collector for long.
export async function runMigrations(connectionString: string): Promise<number | undefined> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 15_000 });
  await client.connect();
  try {
    await client.query("SET lock_timeout = '5s'; SET statement_timeout = '60s'");
    await migrate(drizzle(client), {
      migrationsFolder: "migrations",
      migrationsSchema: "drizzle",
      migrationsTable: "migrations",
    });
    const state = await client.query<{ schema_version: number }>(
      "SELECT schema_version FROM core.schema_state",
    );
    return state.rows[0]?.schema_version;
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const version = await runMigrations(databaseUrl.parse(process.env.DATABASE_URL_MIGRATOR));
  console.log(`Migrations done. Schema version ${version ?? "unknown"}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    // Connection strings are removed from the message before it reaches the log.
    const code = error instanceof Error && "code" in error ? String(error.code) : "unknown";
    const message = error instanceof Error ? error.message.replace(/postgres(ql)?:\/\/\S+/g, "[url]") : "";
    console.error(`Migration failed (code ${code}): ${message}`);
    process.exit(1);
  });
}
