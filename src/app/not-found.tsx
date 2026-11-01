import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Frame } from "@/components/layout/frame";
import { PageHead } from "@/components/layout/page-head";
import { Button } from "@/components/ui/button";
import { homePath, openMarkets, openViews } from "@/lib/auth/permissions";
import { getViewer } from "@/lib/auth/session";
import { moduleByKey } from "@/lib/modules";

import { frameProps } from "./frame-props";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notFound");
  return { title: t("heading") };
}

// A page that doesn't exist (plan 4.10): "Page not found" and a button to the
// user's start page, inside the frame for someone signed in.
export default async function NotFound() {
  const t = await getTranslations("notFound");
  const tn = await getTranslations("noAccess");
  const viewer = await getViewer();
  if (!viewer) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6">
        <h1 className="text-h3">{t("heading")}</h1>
        <Button asChild variant="outline">
          <Link href="/sign-in">{t("signIn")}</Link>
        </Button>
      </main>
    );
  }
  const [view] = openViews(viewer);
  const page = view ? moduleByKey(view).pages[0]!.name : tn("heading");
  return (
    <Frame {...await frameProps(viewer, openMarkets(viewer)[0])}>
      <PageHead title={t("heading")} />
      <Button asChild variant="outline">
        <Link href={homePath(viewer)}>{t("goTo", { page })}</Link>
      </Button>
    </Frame>
  );
}
