import { Client } from "pg";

import { isStale } from "../src/lib/availability/freshness";
import { measuredMarkets } from "../src/lib/markets";

// The second guard (plan 7), run by watch.yml every third hour with the
// backup's read-only role. It fails, and GitHub e-mails about it, when the
// data is as old as the app's banner would say (plan 8.3) or the guard hasn't
// run for a day. That channel goes through neither Vercel nor Resend. It
// prints counts and times only.

const GUARD_MAX_AGE_HOURS = 26;
const HOUR_MS = 60 * 60_000;

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL_BACKUP;
  if (!url) throw new Error("DATABASE_URL_BACKUP is missing");
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 15_000 });
  await client.connect();
  try {
    const now = new Date();
    const problems: string[] = [];

    for (const market of measuredMarkets()) {
      const runs = await client.query<{ schedule_point: Date }>(
        `SELECT r.schedule_point FROM core.job_run r JOIN core.country c ON c.id = r.country_id
         WHERE r.job = 'availability' AND r.status = 'succeeded' AND c.code = $1
           AND r.schedule_point > now() - interval '2 days'`,
        [market.code],
      );
      const points = runs.rows.map((r) => r.schedule_point);
      if (isStale(now, points, market.timeZone)) {
        problems.push(`${market.code}: no successful measurement at the two latest schedule points.`);
      }
    }

    const guard = await client.query<{ finished: Date | null }>(
      "SELECT max(finished_at) AS finished FROM core.job_run WHERE job = 'guard' AND status = 'succeeded'",
    );
    const finished = guard.rows[0]?.finished ?? null;
    if (!finished || now.getTime() - finished.getTime() > GUARD_MAX_AGE_HOURS * HOUR_MS) {
      problems.push(`The guard has not run since ${finished?.toISOString() ?? "it was set up"}.`);
    }

    if (problems.length > 0) {
      console.error(problems.join("\n"));
      return 1;
    }
    console.log("Measurements and the guard are up to date.");
    return 0;
  } finally {
    await client.end();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : "The check failed");
    process.exit(1);
  },
);
