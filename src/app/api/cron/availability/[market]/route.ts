import { connection } from "next/server";

import { runAvailability } from "@/jobs/availability/run";
import { isAuthorizedCron } from "@/jobs/runtime/cron-auth";
import { jobEnvironment } from "@/jobs/runtime/env";
import { isMarketCode, marketByCode } from "@/lib/markets";

// Vercel Cron calls this for one market (plan 7). 19 entries per market on
// Hobby, one on Pro; the code is the same.
export const maxDuration = 300;

export async function GET(
  request: Request,
  context: { params: Promise<{ market: string }> },
): Promise<Response> {
  // Always run per request, never at build.
  await connection();
  const env = jobEnvironment();
  if (!isAuthorizedCron(request.headers.get("authorization"), env.CRON_SECRET)) {
    return new Response(null, { status: 401 });
  }
  const { market } = await context.params;
  if (!isMarketCode(market) || marketByCode(market).sources.length === 0) {
    return new Response(null, { status: 404 });
  }
  const outcome = await runAvailability({ market, now: new Date(), env });
  return Response.json(outcome, { headers: { "Cache-Control": "no-store" } });
}
