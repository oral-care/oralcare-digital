import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { emailOTP } from "better-auth/plugins/email-otp";
import { drizzle } from "drizzle-orm/node-postgres";
import { after } from "next/server";

import { appPool } from "@/lib/db/app";
import { accounts, sessions, users, verifications } from "@/lib/db/schema/auth";
import { appEnvironment } from "@/lib/env";

import { isGroupEmail, normalizeEmail } from "./allowed-email";
import { audit, deliverCode } from "./deliver-code";
import { acceptInvitation, openInvitation } from "./invitation";
import { testFetcher } from "./test-inbox";
import { clientIp, isLocked, recordFailure } from "./throttle";

// Better Auth (plan 11): codes by e-mail only, 8 digits valid 10 minutes with
// 3 tries, stored encrypted, the same code again on a new request. No
// passwords, no links, no sign-up without an invitation. Sessions last 8 hours
// and are renewed hourly, with no cookie cache so changes apply at once; the
// 12-hour ceiling is in session.ts. Its own limiter and telemetry are off.

export const COOKIE_PREFIX = "oc";
const HOUR = 60 * 60;

const LOCKED = "SIGN_IN_LOCKED";
const WRONG_CODE = new Set(["INVALID_OTP", "TOO_MANY_ATTEMPTS"]);

const ip = (headers: Headers | undefined) => clientIp(headers?.get("x-forwarded-for") ?? null);

function createAuth() {
  const env = appEnvironment();
  const pool = appPool();
  return betterAuth({
    appName: "Oral Care Digital",
    baseURL: env.APP_URL,
    trustedOrigins: [env.APP_URL],
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(drizzle(pool), {
      provider: "pg",
      usePlural: true,
      schema: { users, sessions, accounts, verifications },
    }),
    telemetry: { enabled: false },
    rateLimit: { enabled: false },
    emailAndPassword: { enabled: false },
    session: { expiresIn: 8 * HOUR, updateAge: HOUR, cookieCache: { enabled: false } },
    user: {
      additionalFields: {
        firstName: { type: "string", input: false, required: false },
        lastName: { type: "string", input: false, required: false },
        role: { type: "string", input: false, required: false, defaultValue: "viewer" },
        external: { type: "boolean", input: false, required: false, defaultValue: false },
        lastSignInAt: { type: "date", input: false, required: false },
      },
    },
    advanced: {
      cookiePrefix: COOKIE_PREFIX,
      useSecureCookies: env.APP_URL.startsWith("https://"),
      crossSubDomainCookies: { enabled: false },
    },
    databaseHooks: {
      user: {
        create: {
          // Only an address with an unused invitation becomes a user, with the invitation's name and role.
          before: async (user) => {
            const invitation = await openInvitation(pool, user.email.toLowerCase());
            if (!invitation) return false;
            return {
              data: {
                ...user,
                name: `${invitation.firstName} ${invitation.lastName}`,
                firstName: invitation.firstName,
                lastName: invitation.lastName,
                role: invitation.role,
                external: !isGroupEmail(user.email.toLowerCase()),
              },
            };
          },
          after: async (user) => {
            await acceptInvitation(pool, user.id, user.email.toLowerCase());
          },
        },
      },
      session: {
        create: {
          after: async (session) => {
            const result = await pool.query<{ email: string }>(
              "UPDATE auth.users SET last_sign_in_at = now() WHERE id = $1 RETURNING email",
              [session.userId],
            );
            await audit(pool, "sign_in.succeeded", result.rows[0]?.email ?? "", session.userId);
          },
        },
      },
    },
    hooks: {
      // A locked address or IP address can't try another code (plan 11).
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email-otp") return;
        const email = normalizeEmail(String(ctx.body?.email ?? ""));
        if (email && (await isLocked(pool, email, ip(ctx.headers)))) {
          throw APIError.from("TOO_MANY_REQUESTS", { code: LOCKED, message: "Wait a while and try again." });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email-otp") return;
        const returned = ctx.context.returned;
        const code =
          returned instanceof APIError ? (returned.body as { code?: string } | undefined)?.code : undefined;
        if (!code || !WRONG_CODE.has(code)) return;
        const email = normalizeEmail(String(ctx.body?.email ?? ""));
        if (!email) return;
        await recordFailure(pool, email, ip(ctx.headers));
        await audit(pool, "sign_in.failed", email);
      }),
    },
    plugins: [
      emailOTP({
        otpLength: 8,
        expiresIn: 600,
        allowedAttempts: 3,
        storeOTP: "encrypted",
        resendStrategy: "reuse",
        sendVerificationOTP: async ({ email, otp, type }, ctx) => {
          if (type !== "sign-in") return;
          const address = ip(ctx?.headers);
          // After the response, so every address gets the same answer in the same time (plan 11).
          after(async () => {
            // The end-to-end tests read the e-mail from src/lib/auth/test-inbox.ts instead of Resend.
            const test = env.APP_ENV === "test";
            const result = await deliverCode(pool, {
              email: email.toLowerCase(),
              code: otp,
              ip: address,
              apiKey: test ? "re_test_inbox_0000000000" : env.RESEND_API_KEY,
              fetcher: test ? testFetcher : undefined,
            });
            if (result.startsWith("failed:")) console.error(`sign-in code not sent: ${result}`);
          });
        },
      }),
      nextCookies(),
    ],
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

/** Made on first use, since the environment is only there at runtime. */
export function getAuth(): ReturnType<typeof createAuth> {
  instance ??= createAuth();
  return instance;
}
