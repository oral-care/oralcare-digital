import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";

import { runMigrations } from "../../scripts/migrate";
import { PEOPLE } from "./people";

// The end-to-end tests' server (plan 15.3): a fresh Postgres with the roles,
// every migration and made-up data, then the built app with next start and
// APP_ENV=test, so codes go to the test inbox instead of Resend. Run by
// playwright.config.ts after pnpm build. Stops everything when Playwright does.

export const PORT = 3100;
const DB_PORT = 54339;
const ROLES = ["oc_migrator", "oc_collector", "oc_app", "oc_backup"] as const;

const ALL_VIEWS = ["availability", "booking-statistics", "nps", "funnel", "tracking-framework", "monitoring"];

async function main(): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "oralcare-digital-e2e-"));
  const postgres = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password: "postgres",
    port: DB_PORT,
    persistent: false,
    onLog: () => undefined,
  });
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase("oralcare_digital");
  const url = (user: string, password: string) =>
    `postgresql://${user}:${password}@localhost:${DB_PORT}/oralcare_digital`;

  let script = await readFile(path.resolve("scripts/sql/create-roles.sql"), "utf8");
  for (const role of ROLES) script = script.replace(`<<PASSWORD ${role}>>`, `e2e-${role}`);
  const owner = new Client({ connectionString: url("postgres", "postgres") });
  await owner.connect();
  await owner.query(script);
  await runMigrations(url("oc_migrator", "e2e-oc_migrator"));

  // Invitations; each person's account is made by their first sign-in in the tests.
  for (const person of Object.values(PEOPLE)) {
    await owner.query(
      `INSERT INTO auth.invitation (email, first_name, last_name, role, views, markets) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        person.email,
        person.first,
        person.last,
        person.role,
        person.views === "all" ? ALL_VIEWS : person.views,
        person.markets,
      ],
    );
  }
  // A measurement at each of the last two even Swedish hours, so the frame has a time and no banner.
  await owner.query(
    `INSERT INTO core.job_run (job, country_id, schedule_point, status, started_at, finished_at, code_version)
     SELECT 'availability', c.id, p.point, 'succeeded', p.point + interval '4 minutes', p.point + interval '5 minutes', 'e2e'
     FROM core.country c,
          LATERAL (SELECT (date_trunc('hour', now() AT TIME ZONE 'Europe/Stockholm')
                           - make_interval(hours => extract(hour FROM now() AT TIME ZONE 'Europe/Stockholm')::int % 2 + k * 2))
                          AT TIME ZONE 'Europe/Stockholm' AS point
                   FROM generate_series(0, 1) AS k) p
     WHERE c.code = 'se'`,
  );
  await owner.end();

  const app = spawn("pnpm", ["exec", "next", "start", "-p", String(PORT)], {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      APP_ENV: "test",
      APP_URL: `http://localhost:${PORT}`,
      DATABASE_URL_APP: url("oc_app", "e2e-oc_app"),
      DATABASE_URL_COLLECTOR: url("oc_collector", "e2e-oc_collector"),
      CRON_SECRET: "0".repeat(64),
      BETTER_AUTH_SECRET: "an-end-to-end-test-secret-of-enough-length",
    },
  });

  const stop = async () => {
    app.kill("SIGTERM");
    await postgres.stop();
    await rm(dir, { recursive: true, force: true });
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  app.on("exit", (code) => void stop().then(() => process.exit(code ?? 1)));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
