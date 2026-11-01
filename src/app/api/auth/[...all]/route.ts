import { connection } from "next/server";

import { getAuth } from "@/lib/auth/auth";

// Only the four Better Auth endpoints the app uses answer (plan 11). Anything
// else gives 404, also endpoints a later version of Better Auth adds.

const ALLOWED = new Set([
  "POST /api/auth/sign-in/email-otp",
  "POST /api/auth/email-otp/send-verification-otp",
  "GET /api/auth/get-session",
  "POST /api/auth/sign-out",
]);

async function handle(request: Request): Promise<Response> {
  await connection();
  if (!ALLOWED.has(`${request.method} ${new URL(request.url).pathname}`)) {
    return new Response(null, { status: 404 });
  }
  return getAuth().handler(request);
}

export const GET = handle;
export const POST = handle;
