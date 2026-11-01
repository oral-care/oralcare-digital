import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { EmptyState } from "@/components/layout/empty-state";
import { MODULE_ICONS } from "@/components/layout/icons";
import { PageHead } from "@/components/layout/page-head";
import { MODULES, type Module } from "@/lib/modules";

import { requireView } from "../access";

type Params = Promise<{ market: string; view: string }>;

function comingSoon(view: string): Module {
  const found = MODULES.find((m) => m.group === "coming-soon" && m.path === view);
  if (!found) notFound();
  return found;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { view } = await params;
  const found = MODULES.find((m) => m.group === "coming-soon" && m.path === view);
  return { title: found?.name ?? (await getTranslations("notFound"))("heading") };
}

// The modules that aren't built yet (plan 4.8): the module's name and icon,
// "Coming soon" and "{module} is being built."
export default async function ComingSoon({ params }: { params: Params }) {
  const { market, view } = await params;
  const soon = comingSoon(view);
  await requireView(market, soon.key);
  const t = await getTranslations("comingSoon");
  return (
    <>
      <PageHead title={soon.name} />
      <EmptyState icon={MODULE_ICONS[soon.icon]} title={t("title")} text={t("text", { module: soon.name })} />
    </>
  );
}
