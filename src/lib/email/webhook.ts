import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

// Resend's webhook for bounces and complaints (plan 11 and 17.4). Resend signs
// with Svix: an HMAC-SHA256 over "id.timestamp.body" with the secret after
// "whsec_", sent as one or more "v1,<base64>" in svix-signature. The raw body
// is checked, with 5 minutes' tolerance on the timestamp. Pure module.

export const TOLERANCE_SECONDS = 5 * 60;

export type SignatureHeaders = { id: string | null; timestamp: string | null; signature: string | null };

export function verifySignature(secret: string, headers: SignatureHeaders, body: string, now: Date): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

const event = z.object({
  type: z.string(),
  data: z.object({
    to: z.array(z.string()).optional(),
    bounce: z.object({ type: z.string() }).optional(),
  }),
});

export type Suppression = { emails: string[]; reason: "bounce" | "complaint" };

/** Only permanent bounces and complaints stop e-mail to an address (plan 9). */
export function suppressionFrom(json: unknown): Suppression | null {
  const parsed = event.safeParse(json);
  if (!parsed.success) throw new Error("Unexpected webhook format");
  const { type, data } = parsed.data;
  const emails = (data.to ?? []).map((address) => address.trim().toLowerCase()).filter(Boolean);
  if (emails.length === 0) return null;
  if (type === "email.complained") return { emails, reason: "complaint" };
  if (type === "email.bounced" && data.bounce?.type.toLowerCase() === "permanent")
    return { emails, reason: "bounce" };
  return null;
}
