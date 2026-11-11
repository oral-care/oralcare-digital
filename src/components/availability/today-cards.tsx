import { getTranslations } from "next-intl/server";

import type { CardCounts } from "@/lib/availability/figures";
import { formatCount } from "@/lib/availability/format";

import { StatCard, StatGrid } from "./stat-card";

// The eight cards on What patients see (plan 4.4): availability and Slots not
// online in the first row, waiting time and Not online in the second. Each row
// counts every clinic in the filter once.
export async function TodayCards({ counts, hiddenHref }: { counts: CardCounts; hiddenHref: string }) {
  const t = await getTranslations("availability");
  const card = (key: Exclude<keyof CardCounts, "slotsNotOnline" | "unknown">) => (
    <StatCard
      key={key}
      label={t(`cards.${key}.label`)}
      value={formatCount(counts[key])}
      unit={t("unit.clinics", { count: counts[key] })}
      note={t(`cards.${key}.note`)}
    />
  );
  return (
    <>
      <StatGrid>
        {card("good")}
        {card("mixed")}
        {card("low")}
        <StatCard
          label={t("cards.slotsNotOnline.label")}
          value={formatCount(counts.slotsNotOnline)}
          unit={t("unit.clinics", { count: counts.slotsNotOnline })}
          note={t("cards.slotsNotOnline.note")}
          link={{ href: hiddenHref, text: t("cards.slotsNotOnline.go") }}
          attention={counts.slotsNotOnline > 0}
        />
        {card("short")}
        {card("mixedWait")}
        {card("long")}
        {card("notOnline")}
      </StatGrid>
      {/* Clinics that could not be measured are in no card (plan 5.7). */}
      {counts.unknown > 0 ? (
        <p className="mt-3 text-paragraph-small text-muted-foreground">
          {t("cards.unknown", { count: counts.unknown })}
        </p>
      ) : null}
    </>
  );
}
