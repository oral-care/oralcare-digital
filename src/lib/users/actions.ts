"use server";

import { revalidatePath } from "next/cache";

import { getViewer } from "@/lib/auth/session";
import { testFetcher } from "@/lib/auth/test-inbox";
import { appPool } from "@/lib/db/app";
import { appEnvironment } from "@/lib/env";

import { inviteUser, removeUser, updateUser, type AccessInput, type Result } from "./manage";

// The Users page's server actions (plan 11). Each checks the signed-in admin
// itself; the rules are in manage.ts.

const signedOut: Result = { ok: false, errors: { form: "users.errors.notAllowed" } };

export async function inviteAction(input: AccessInput & { email: string }): Promise<Result> {
  const viewer = await getViewer();
  if (!viewer) return signedOut;
  const env = appEnvironment();
  // The end-to-end tests read the invitation from the test inbox instead of Resend.
  const mail =
    env.APP_ENV === "test"
      ? { apiKey: "re_test_inbox_0000000000", fetcher: testFetcher }
      : { apiKey: env.RESEND_API_KEY };
  const result = await inviteUser(appPool(), viewer, input, mail);
  if (result.ok) revalidatePath("/[market]/admin/users", "page");
  return result;
}

export async function updateAction(id: string, input: AccessInput): Promise<Result> {
  const viewer = await getViewer();
  if (!viewer) return signedOut;
  const result = await updateUser(appPool(), viewer, id, input);
  if (result.ok) revalidatePath("/[market]/admin/users", "page");
  return result;
}

export async function removeAction(id: string): Promise<Result> {
  const viewer = await getViewer();
  if (!viewer) return signedOut;
  const result = await removeUser(appPool(), viewer, id);
  if (result.ok) revalidatePath("/[market]/admin/users", "page");
  return result;
}
