import "server-only";

import type { Fetcher } from "@/lib/email/resend";

// The end-to-end tests' code receiver (plan 15.3): with APP_ENV=test the
// e-mails go here instead of to Resend, and /api/test/inbox hands the latest
// one to the test. APP_ENV=test is refused on Vercel (src/lib/env.ts), so this
// can never run there.

// On globalThis, since Next.js bundles routes and server actions apart and each would get its own copy.
const holder = globalThis as typeof globalThis & { __ocTestInbox?: Map<string, string> };
const inbox = (holder.__ocTestInbox ??= new Map<string, string>());

export const testFetcher: Fetcher = async (_url, init) => {
  const emails = JSON.parse(String(init.body)) as { to: string[]; text: string }[];
  for (const email of emails) for (const to of email.to) inbox.set(to, email.text);
  return new Response("{}", { status: 200 });
};

export function latestEmail(address: string): string | null {
  return inbox.get(address.toLowerCase()) ?? null;
}
