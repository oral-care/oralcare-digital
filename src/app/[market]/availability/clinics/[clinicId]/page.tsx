import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { requireView } from "../../../access";
import { AvailabilityPlaceholder } from "../../placeholder";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages");
  return { title: t("clinic") };
}

export default async function Clinic({ params }: { params: Promise<{ market: string; clinicId: string }> }) {
  const { market } = await requireView((await params).market, "availability");
  const t = await getTranslations("pages");
  return <AvailabilityPlaceholder market={market} title={t("clinic")} />;
}
