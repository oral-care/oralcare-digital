import type { Client } from "pg";

import { SENDER_ADDRESS, type Email } from "@/lib/email/layout";
import { t } from "@/lib/messages";

import { USER_AGENT, type Fetcher } from "./http";

// The jobs' e-mail sender (plan 9 and 11): one e-mail per admin in one batch
// call to Resend, counted first with core.reserve_email, which refuses past
// the day's cap. The Idempotency-Key makes a retry within 24 hours a no-op
// at Resend, so the same e-mail is never sent twice.

const RESEND_BATCH = "https://api.resend.com/emails/batch";
const TIMEOUT_MS = 15_000;

export const SENDER = `${t("email.sender")} <${SENDER_ADDRESS}>`;

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

  const { subject, html, text } = input.email;
  const body = admins.map((to) => ({
    from: SENDER,
    to: [to],
    reply_to: SENDER_ADDRESS,
    subject,
    html,
    text,
  }));
  try {
    const response = await (input.fetcher ?? fetch)(RESEND_BATCH, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // The body may name addresses, so only the status is kept.
    await response.body?.cancel();
    return response.ok
      ? { status: "sent", recipients: admins.length }
      : { status: "failed", code: `resend_${response.status}` };
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { status: "failed", code: timeout ? "resend_timeout" : "resend_network" };
  }
}
