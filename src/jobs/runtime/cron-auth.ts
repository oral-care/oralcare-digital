import { timingSafeEqual } from "node:crypto";

// Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` (plan 7). Compared in
// constant time.
export function isAuthorizedCron(authorization: string | null, secret: string): boolean {
  if (!authorization) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(authorization);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
