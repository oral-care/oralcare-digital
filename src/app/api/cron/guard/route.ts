import { connection } from "next/server";

import { runGuard } from "@/jobs/guard/run";
import { isAuthorizedCron } from "@/jobs/runtime/cron-auth";
import { jobEnvironment } from "@/jobs/runtime/env";

// Vercel Cron calls the guard at 09 and 10 UTC (plan 7).
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  // Always run per request, never at build.
  await connection();
  const env = jobEnvironment();
  if (!isAuthorizedCron(request.headers.get("authorization"), env.CRON_SECRET)) {
    return new Response(null, { status: 401 });
  }
  const outcome = await runGuard({ now: new Date(), env });
  return Response.json(outcome, { headers: { "Cache-Control": "no-store" } });
}
