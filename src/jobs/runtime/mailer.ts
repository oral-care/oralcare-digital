import type { Client } from "pg";

import type { Email } from "@/lib/email/layout";
import { sendBatch } from "@/lib/email/resend";

import type { Fetcher } from "./http";

// The jobs' e-mail sender (plan 9 and 11): one e-mail per admin in one batch
// call to Resend, counted first with core.reserve_email, which refuses past
// the day's cap. The Idempotency-Key makes a retry within 24 hours a no-op
// at Resend, so the same e-mail is never sent twice.

export type MailType = "alert" | "summary";

export type SendResult =
  | { status: "sent"; recipients: number }
  | { status: "skipped"; reason: "no_api_key" | "no_recipients" | "quota" }
  | { status: "failed"; code: string };

export async function sendToAdmins(
  client: Client,
  input: {
    apiKey: string | undefined;
    type: MailType;
    idempotencyKey: string;
    email: Email;
    fetcher?: Fetcher;
  },
): Promise<SendResult> {
  if (!input.apiKey) return { status: "skipped", reason: "no_api_key" };
  const admins = (await client.query<{ email: string }>("SELECT core.admin_emails() AS email")).rows.map(
    (r) => r.email,
  );
  if (admins.length === 0) return { status: "skipped", reason: "no_recipients" };

  const reserved = await client.query<{ ok: boolean }>("SELECT core.reserve_email($1, $2) AS ok", [
    input.type,
    admins.length,
  ]);
  if (!reserved.rows[0]?.ok) return { status: "skipped", reason: "quota" };

  const result = await sendBatch({
    apiKey: input.apiKey,
    recipients: admins,
    email: input.email,
    idempotencyKey: input.idempotencyKey,
    fetcher: input.fetcher,
  });
  return result.ok ? { status: "sent", recipients: admins.length } : { status: "failed", code: result.code };
}
