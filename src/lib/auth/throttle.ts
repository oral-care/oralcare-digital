import "server-only";

import type { Pool, PoolClient } from "pg";

// The sign-in limits (plan 11), as atomic counters in auth.login_throttle:
// at most 3 codes per 15 minutes and 10 per day, per address and per IP
// address, and 20 per week per address; and after 3, 6 and 9 wrong codes per
// address or IP address a wait of 1, 15 and 60 minutes. Better Auth's own
// limiter is off, since it would wake the database for anonymous calls.

type Db = Pick<Pool | PoolClient, "query">;

const MINUTE = 60_000;
const CODE_LIMITS = [
  { scope: "code:15m", per: ["email", "ip"], max: 3, bucket: (now: Date) => floorTo(now, 15 * MINUTE) },
  { scope: "code:day", per: ["email", "ip"], max: 10, bucket: (now: Date) => floorTo(now, 24 * 60 * MINUTE) },
  { scope: "code:week", per: ["email"], max: 20, bucket: weekStart },
] as const;
const WAITS = [
  { after: 3, minutes: 1 },
  { after: 6, minutes: 15 },
  { after: 9, minutes: 60 },
];

function floorTo(now: Date, size: number): Date {
  return new Date(Math.floor(now.getTime() / size) * size);
}

/** Monday 00:00 UTC of the ISO week. */
function weekStart(now: Date): Date {
  const day = floorTo(now, 24 * 60 * MINUTE);
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - sinceMonday * 24 * 60 * MINUTE);
}

/**
 * The client's address: the first value in x-forwarded-for, which Vercel sets.
 * IPv6 addresses count per /64, since one connection usually has a whole /64.
 */
export function clientIp(forwardedFor: string | null): string {
  const first = forwardedFor?.split(",")[0]?.trim() ?? "";
  if (!first) return "unknown";
  if (!first.includes(":")) return first;
  const groups = first.split("::")[0]!.split(":").filter(Boolean);
  const full = first.includes("::") ? [...groups, "0", "0", "0", "0"] : groups;
  return `${full.slice(0, 4).join(":")}::/64`;
}

async function increment(db: Db, scope: string, key: string, windowStart: Date): Promise<number> {
  const result = await db.query<{ count: number }>(
    `INSERT INTO auth.login_throttle (scope, key, window_start, count) VALUES ($1, $2, $3, 1)
     ON CONFLICT (scope, key, window_start) DO UPDATE SET count = auth.login_throttle.count + 1
     RETURNING count`,
    [scope, key, windowStart],
  );
  return result.rows[0]?.count ?? 0;
}

/** Counts a code request and says whether it is within every limit. */
export async function allowCodeRequest(
  db: Db,
  email: string,
  ip: string,
  now: Date = new Date(),
): Promise<boolean> {
  let allowed = true;
  for (const limit of CODE_LIMITS) {
    for (const per of limit.per) {
      const key = per === "email" ? `email:${email}` : `ip:${ip}`;
      if ((await increment(db, limit.scope, key, limit.bucket(now))) > limit.max) allowed = false;
    }
  }
  return allowed;
}

/** Whether the address or the IP address has to wait after wrong codes. */
export async function isLocked(db: Db, email: string, ip: string, now: Date = new Date()): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM auth.login_throttle WHERE scope = 'lock' AND key = ANY($1::text[]) AND window_start > $2 LIMIT 1`,
    [[`email:${email}`, `ip:${ip}`], now],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Counts a wrong code and starts the wait at 3, 6 and 9 per UTC day. */
export async function recordFailure(
  db: Db,
  email: string,
  ip: string,
  now: Date = new Date(),
): Promise<void> {
  for (const key of [`email:${email}`, `ip:${ip}`]) {
    const failures = await increment(db, "fail:day", key, floorTo(now, 24 * 60 * MINUTE));
    const wait = [...WAITS].reverse().find((w) => failures >= w.after && failures % 3 === 0);
    if (wait) {
      // The lock row's window_start is when the wait ends.
      await db.query(
        `INSERT INTO auth.login_throttle (scope, key, window_start, count) VALUES ('lock', $1, $2, 0)
         ON CONFLICT (scope, key, window_start) DO NOTHING`,
        [key, new Date(now.getTime() + wait.minutes * MINUTE)],
      );
    }
  }
}
