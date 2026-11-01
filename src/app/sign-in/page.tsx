import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AuthNote, AuthShell } from "@/components/sign-in/auth-shell";
import { EmailForm } from "@/components/sign-in/email-form";
import { homePath } from "@/lib/auth/permissions";
import { getViewer } from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("signIn");
  return { title: t("title") };
}

export default async function SignIn() {
  const viewer = await getViewer();
  if (viewer) redirect(homePath(viewer));
  const t = await getTranslations("signIn");
  return (
    <AuthShell>
      <AuthNote>{t("intro")}</AuthNote>
      <EmailForm />
    </AuthShell>
  );
}
