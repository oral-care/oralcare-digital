import { defineConfig } from "drizzle-kit";

// Generates migrations from the schema. Migrations are run by scripts/migrate.ts
// as oc_migrator in the deploy workflow, never by Vercel (plan 10.5).
export default defineConfig({
  dialect: "postgresql",
  schema: [
    "./src/lib/db/schema/core.ts",
    "./src/lib/db/schema/auth.ts",
    "./src/lib/db/schema/availability.ts",
  ],
  out: "./migrations",
  schemaFilter: ["core", "auth", "availability"],
  migrations: {
    prefix: "timestamp",
    schema: "drizzle",
    table: "migrations",
  },
  strict: true,
  verbose: true,
});
