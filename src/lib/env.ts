import { z } from "zod";

// Environment variables for the app, checked with zod on first use and at
// build on Vercel (plan 12). Pure module: the jobs read the same rules through
// src/jobs/runtime/env.ts, so this file must never import "server-only".

const appEnv = z.enum(["development", "test", "production"]);

// Neon's integration variables must never be present: the app connects only
// with its own least-privilege roles (plan 10.4). Matched by pattern, since the
// integration creates many names and can add a prefix.
const NEON_DEFAULT_VARIABLE =
  /^(PG\w*|POSTGRES_\w+|DATABASE_URL(_UNPOOLED)?|NEON_\w+|\w+_(DATABASE_URL|POSTGRES_URL)\w*)$/;

const OWNER_ROLE = "neondb_owner";

export const databaseUrl = z
  .url()
  .refine((value) => new URL(value).protocol === "postgresql:" || new URL(value).protocol === "postgres:", {
    message: "must be a postgres URL",
  })
  .refine((value) => decodeURIComponent(new URL(value).username) !== OWNER_ROLE, {
    message: `must not use the owner role ${OWNER_ROLE}`,
  });

export const cronSecret = z.string().regex(/^[0-9a-f]{64}$/, "must be 64 lowercase hex characters");

export const appEnvSchema = z.object({
  APP_ENV: appEnv,
  APP_URL: z.url(),
  DATABASE_URL_APP: databaseUrl,
  CRON_SECRET: cronSecret,
  // Resend's signing secret for /api/webhooks/resend. Until it is set, the webhook answers 503.
  RESEND_WEBHOOK_SECRET: z.string().startsWith("whsec_").min(20).optional(),
  // Signs and encrypts sessions and codes (plan 11). Changing it signs everyone out.
  BETTER_AUTH_SECRET: z.string().min(32),
  // Sign-in codes and invitations. Without it no e-mail goes out.
  RESEND_API_KEY: z.string().startsWith("re_").min(20).optional(),
});

export type AppEnv = z.infer<typeof appEnvSchema>;

/** Rules that apply to every process, whatever it reads. */
export function assertSafeEnvironment(source: NodeJS.ProcessEnv = process.env): void {
  // The test-only code receiver must never exist on Vercel (plan 12).
  if (source.APP_ENV === "test" && source.VERCEL) {
    throw new Error("APP_ENV=test is not allowed on Vercel");
  }
  const present = Object.keys(source).filter((name) => NEON_DEFAULT_VARIABLE.test(name) && source[name]);
  if (present.length > 0 && source.APP_ENV === "production") {
    throw new Error(`Neon default variables must be removed: ${present.join(", ")}`);
  }
}

/** Everything a production deployment needs, checked by next.config.ts at build on Vercel. */
export const productionEnvSchema = appEnvSchema.extend({ DATABASE_URL_COLLECTOR: databaseUrl });

export function assertProductionEnvironment(source: NodeJS.ProcessEnv = process.env): void {
  assertSafeEnvironment(source);
  productionEnvSchema.parse(source);
}

let cached: AppEnv | undefined;

export function appEnvironment(source: NodeJS.ProcessEnv = process.env): AppEnv {
  if (cached && source === process.env) return cached;
  assertSafeEnvironment(source);
  const parsed = appEnvSchema.parse(source);
  if (source === process.env) cached = parsed;
  return parsed;
}
