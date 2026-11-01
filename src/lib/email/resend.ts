import { t } from "@/lib/messages";

import { SENDER_ADDRESS, type Email } from "./layout";

// Resend's batch API with fetch (plan 9): one e-mail per recipient in one
// call, an optional Idempotency-Key that makes a retry within 24 hours a no-op,
// a timeout, and only the status kept from the answer, since its body names
// addresses. Used by the app and by the jobs. Pure module apart from the call.

const RESEND_BATCH = "https://api.resend.com/emails/batch";
const TIMEOUT_MS = 15_000;
const USER_AGENT = "OralCareDigital/1.0 (+digital@oralcaregroup.com)";

export const SENDER = `${t("email.sender")} <${SENDER_ADDRESS}>`;

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export type ResendResult = { ok: true } | { ok: false; code: string };

export async function sendBatch(input: {
  apiKey: string;
  recipients: string[];
  email: Email;
  idempotencyKey?: string;
  fetcher?: Fetcher;
}): Promise<ResendResult> {
  const { subject, html, text } = input.email;
  const body = input.recipients.map((to) => ({
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
        "User-Agent": USER_AGENT,
        ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await response.body?.cancel();
    return response.ok ? { ok: true } : { ok: false, code: `resend_${response.status}` };
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { ok: false, code: timeout ? "resend_timeout" : "resend_network" };
  }
}
