import { connection } from "next/server";

import { latestEmail } from "@/lib/auth/test-inbox";
import { appEnvironment } from "@/lib/env";

// The end-to-end tests read the latest e-mail to an address here (plan 15.3).
// Outside APP_ENV=test the route doesn't exist.
export async function GET(request: Request): Promise<Response> {
  await connection();
  if (appEnvironment().APP_ENV !== "test") return new Response(null, { status: 404 });
  const address = new URL(request.url).searchParams.get("address") ?? "";
  const text = latestEmail(address);
  return text === null ? new Response(null, { status: 404 }) : new Response(text, { status: 200 });
}
