import "server-only";

import type { Pool } from "pg";

import { signInCodeEmail } from "@/lib/email/emails";
import { sendBatch, type Fetcher } from "@/lib/email/resend";

import { normalizeEmail } from "./allowed-email";
import { allowCodeRequest } from "./throttle";

// Who gets a sign-in code (plan 3.1 and 11): only a plain address, from any
// domain, with an account or an invitation, not suppressed after a bounce,
// within the limits and the day's e-mail quota, and only while sign-in isn't
// paused. Everyone else gets the same answer and no code. Runs after the
// response is sent, so the answer takes as long either way.

export type DeliveryResult =
  | "sent"
  | "paused"
  | "not_allowed"
  | "suppressed"
  | "throttled"
  | "quota"
  | "no_api_key"
  | `failed:${string}`;

export async function deliverCode(
  pool: Pool,
  input: { email: string; code: string; ip: string; apiKey: string | undefined; fetcher?: Fetcher },
): Promise<DeliveryResult> {
  const paused = await pool.query<{ value: unknown }>(
    "SELECT value FROM core.config_version WHERE key = 'login_paused' ORDER BY valid_from DESC LIMIT 1",
  );
  if (paused.rows[0]?.value === true) return "paused";

  const email = normalizeEmail(input.email);
  if (!email) return "not_allowed";
  const account = await pool.query<{ known: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM auth.users WHERE email = $1)
         OR EXISTS (SELECT 1 FROM auth.invitation WHERE email = $1 AND used_at IS NULL) AS known`,
    [email],
  );
  if (!account.rows[0]?.known) return "not_allowed";

  const suppressed = await pool.query("SELECT 1 FROM auth.email_suppression WHERE email = $1", [email]);
  if ((suppressed.rowCount ?? 0) > 0) return "suppressed";

  if (!(await allowCodeRequest(pool, email, input.ip))) {
    await audit(pool, "sign_in.blocked", email);
    return "throttled";
  }
  if (!input.apiKey) return "no_api_key";
  const reserved = await pool.query<{ ok: boolean }>("SELECT core.reserve_email('sign-in', 1) AS ok");
  if (!reserved.rows[0]?.ok) return "quota";

  const result = await sendBatch({
    apiKey: input.apiKey,
    recipients: [email],
    email: signInCodeEmail({ code: input.code }),
    fetcher: input.fetcher,
  });
  return result.ok ? "sent" : `failed:${result.code}`;
}

export async function audit(
  pool: Pool,
  event: string,
  email: string,
  userId: string | null = null,
): Promise<void> {
  await pool.query(
    "INSERT INTO auth.audit_event (event, actor_id, subject_id, subject_email) VALUES ($1, $2, $2, $3)",
    [event, userId, email],
  );
}
