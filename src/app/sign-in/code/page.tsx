import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AuthShell } from "@/components/sign-in/auth-shell";
import { CodeForm } from "@/components/sign-in/code-form";
import { homePath } from "@/lib/auth/permissions";
import { getViewer } from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("signIn");
  return { title: t("title") };
}

export default async function SignInCode() {
  const viewer = await getViewer();
  if (viewer) redirect(homePath(viewer));
  return (
    <AuthShell>
      <CodeForm />
    </AuthShell>
  );
}
