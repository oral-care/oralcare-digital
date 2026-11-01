import { appPool } from "@/lib/db/app";
import { suppressionFrom, verifySignature } from "@/lib/email/webhook";
import { appEnvironment } from "@/lib/env";

// Bounces and complaints from Resend (plan 11 and 17.4). A permanent bounce or
// a complaint stops e-mail to the address; everything else is answered and
// dropped. Inserting is idempotent, so a delivery Resend repeats changes
// nothing. Addresses and bodies are never logged.

export async function POST(request: Request): Promise<Response> {
  const env = appEnvironment();
  if (!env.RESEND_WEBHOOK_SECRET) return new Response(null, { status: 503 });

  const body = await request.text();
  const headers = {
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
  };
  if (!verifySignature(env.RESEND_WEBHOOK_SECRET, headers, body, new Date())) {
    return new Response(null, { status: 401 });
  }

  let suppression;
  try {
    suppression = suppressionFrom(JSON.parse(body));
  } catch {
    return new Response(null, { status: 400 });
  }
  if (suppression) {
    await appPool().query(
      `INSERT INTO auth.email_suppression (email, reason)
       SELECT unnest($1::text[]), $2 ON CONFLICT (email) DO NOTHING`,
      [suppression.emails, suppression.reason],
    );
  }
  return new Response(null, { status: 200 });
}
