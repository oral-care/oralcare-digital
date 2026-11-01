import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { EmptyState } from "@/components/layout/empty-state";
import { Frame } from "@/components/layout/frame";
import { PageHead } from "@/components/layout/page-head";
import { homePath, openMarkets } from "@/lib/auth/permissions";
import { getViewer } from "@/lib/auth/session";

import { frameProps } from "../frame-props";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("noAccess");
  return { title: t("heading") };
}

// For someone without a view or a market (plan 3.3 and 4.10).
export default async function NoAccess() {
  const viewer = await getViewer();
  if (!viewer) redirect("/sign-in");
  const home = homePath(viewer);
  if (home !== "/no-access") redirect(home);
  const t = await getTranslations("noAccess");
  return (
    <Frame {...await frameProps(viewer, openMarkets(viewer)[0])}>
      <PageHead title={t("heading")} />
      <EmptyState title={t("title")} text={t("text")} />
    </Frame>
  );
}
