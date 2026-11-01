import { z } from "zod";

import { assertSafeEnvironment, cronSecret, databaseUrl } from "@/lib/env";

// The jobs' environment variables (plan 13.3). Kept apart from the app's so the
// jobs never import "server-only" and can run in tsx and Vitest.

const jobEnvSchema = z.object({
  CRON_SECRET: cronSecret,
  DATABASE_URL_COLLECTOR: databaseUrl,
  DATABASE_URL_APP: databaseUrl,
  // Until it is set, alerts and the summary wait as pending (plan 8.1).
  RESEND_API_KEY: z.string().startsWith("re_").min(20).optional(),
});

export type JobEnv = z.infer<typeof jobEnvSchema>;

export function jobEnvironment(source: NodeJS.ProcessEnv = process.env): JobEnv {
  assertSafeEnvironment(source);
  return jobEnvSchema.parse(source);
}

/**
 * A short commit id for the run log. deploy.yml passes CODE_VERSION, since
 * Vercel leaves VERCEL_GIT_COMMIT_SHA empty for deploys from the command line.
 */
export function codeVersion(source: NodeJS.ProcessEnv = process.env): string {
  return (source.CODE_VERSION || source.VERCEL_GIT_COMMIT_SHA || "local").slice(0, 12);
}
