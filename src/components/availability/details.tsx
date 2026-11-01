import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Sparkline } from "@/components/charts/sparkline";
import { ClickRow } from "@/components/data-table/click-row";
import { HeaderTip } from "@/components/data-table/header-tip";
import { CELL, NUM, Table } from "@/components/data-table/table";
import { formatChange, formatCount } from "@/lib/availability/format";
import type { ClinicRow, TreatmentRow } from "@/lib/availability/views";
import { cn } from "@/lib/utils";

import { waitText } from "./labels";
import { Panel } from "./section";
import { availabilityTone, StatusBadge, waitingTone } from "./status-badge";

// Details on What patients see (plan 4.4): By treatment or By clinic, chosen
// in the address so the view can be shared.

export async function DetailSwitch({
  view,
  hrefs,
}: {
  view: "treatment" | "clinic";
  hrefs: { treatment: string; clinic: string };
}) {
  const t = await getTranslations("availability.details");
  const tab = (key: "treatment" | "clinic", label: string) => (
    <Link
      href={hrefs[key]}
      scroll={false}
      aria-current={view === key ? "page" : undefined}
      className={cn(
        "inline-flex h-7.5 items-center rounded-md px-3 text-paragraph-small font-medium no-underline focus-ring",
        view === key ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label={t("title")} className="inline-flex gap-0.5 rounded-lg bg-secondary p-0.75">
      {tab("treatment", t("byTreatment"))}
      {tab("clinic", t("byClinic"))}
    </nav>
  );
}

function Change({ value, na }: { value: number | null; na: string }) {
  if (value === null) return <span className="text-muted-foreground">{na}</span>;
  return (
    <span
      className={cn(
        value > 0 && "text-delta-up",
        value < 0 && "text-delta-down",
        value === 0 && "text-muted-foreground",
      )}
    >
      {formatChange(value)}
    </span>
  );
}

export async function ByTreatmentTable({
  rows,
  periodLabel,
  rowHref,
}: {
  rows: TreatmentRow[];
  periodLabel: string;
  rowHref: (treatmentId: number) => string;
}) {
  const t = await getTranslations("availability");
  return (
    <Panel>
      <Table>
        <thead>
          <tr>
            <HeaderTip label={t("columns.treatment")} tip={t("tips.treatment")} />
            <HeaderTip label={t("columns.freeSlots")} tip={t("tips.freeSlots")} numeric />
            <HeaderTip label={t("columns.onlineAt")} tip={t("tips.onlineAt")} numeric />
            <HeaderTip label={t("columns.typicalWait")} tip={t("tips.typicalWait")} />
            <HeaderTip label={periodLabel} tip={t("tips.trendAll")} alignRight />
            <HeaderTip label={t("columns.vsPrevious")} tip={t("tips.vsPrevious")} numeric alignRight />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = rowHref(row.treatment.id);
            return (
              <ClickRow key={row.treatment.id} href={href}>
                <td className={CELL}>
                  <Link
                    href={href}
                    scroll={false}
                    className="font-medium text-inherit no-underline focus-ring"
                  >
                    {row.treatment.name}
                  </Link>
                </td>
                <td className={cn(CELL, NUM)}>{formatCount(row.freeSlots)}</td>
                <td className={cn(CELL, NUM)}>
                  {t("ofClinics", { count: row.onlineAt, total: row.clinics })}
                </td>
                <td className={cn(CELL, "whitespace-nowrap")}>
                  {row.typicalWait ? waitText(t, row.typicalWait) : null}
                </td>
                <td className={CELL}>
                  <Sparkline values={row.spark} />
                </td>
                <td className={cn(CELL, NUM)}>
                  <Change value={row.change} na={t("na")} />
                </td>
              </ClickRow>
            );
          })}
        </tbody>
      </Table>
    </Panel>
  );
}

export async function ByClinicTable({
  rows,
  single,
  periodLabel,
  rowHref,
}: {
  rows: ClinicRow[];
  /** One treatment is chosen: Free slots, First free slot and a minigraph instead. */
  single: boolean;
  periodLabel: string;
  rowHref: (clinicId: number) => string;
}) {
  const t = await getTranslations("availability");
  return (
    <Panel>
      <Table>
        <thead>
          <tr>
            <HeaderTip label={t("columns.clinic")} tip={t("tips.clinic")} />
            <HeaderTip label={t("columns.region")} tip={t("tips.region")} />
            {single ? (
              <>
                <HeaderTip label={t("columns.freeSlots")} tip={t("tips.freeSlotsOne")} numeric />
                <HeaderTip label={t("columns.firstFreeSlot")} tip={t("tips.firstFreeSlot")} />
                <HeaderTip label={periodLabel} tip={t("tips.trend")} />
              </>
            ) : (
              <>
                <HeaderTip
                  label={t("columns.treatmentsWithSlots")}
                  tip={t("tips.treatmentsWithSlots")}
                  numeric
                />
                <HeaderTip label={t("columns.fewestSlots")} tip={t("tips.fewestSlots")} />
              </>
            )}
            <HeaderTip label={t("columns.availability")} tip={t("tips.availabilityMixed")} alignRight />
            <HeaderTip label={t("columns.waitingTime")} tip={t("tips.waitingTimeMixed")} alignRight />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = rowHref(row.clinic.id);
            const availability = availabilityTone(row.statuses.availability);
            const waiting = waitingTone(row.statuses.waitingTime);
            return (
              <ClickRow key={row.clinic.id} href={href}>
                <td className={CELL}>
                  <Link href={href} className="font-medium text-inherit no-underline focus-ring">
                    {row.clinic.name}
                  </Link>
                </td>
                <td className={cn(CELL, "text-muted-foreground")}>{row.clinic.region}</td>
                {row.single ? (
                  <>
                    <td className={cn(CELL, NUM)}>
                      {row.single.slots === null ? null : formatCount(row.single.slots)}
                    </td>
                    <td className={cn(CELL, "whitespace-nowrap")}>
                      {row.single.firstFree ? waitText(t, row.single.firstFree) : null}
                    </td>
                    <td className={CELL}>
                      <Sparkline values={row.single.spark} />
                    </td>
                  </>
                ) : (
                  <>
                    <td className={cn(CELL, NUM)}>
                      {t("ofTotal", { count: row.online, total: row.treatments })}
                    </td>
                    <td className={cn(CELL, "text-muted-foreground")}>
                      {row.fewest
                        ? t("fewest", {
                            treatment: row.fewest.treatment,
                            slots: formatCount(row.fewest.slots),
                          })
                        : null}
                    </td>
                  </>
                )}
                <td className={CELL}>
                  {availability ? (
                    <StatusBadge tone={availability}>{t(`status.${row.statuses.availability}`)}</StatusBadge>
                  ) : null}
                </td>
                <td className={CELL}>
                  {waiting ? (
                    <StatusBadge tone={waiting}>{t(`status.${row.statuses.waitingTime}`)}</StatusBadge>
                  ) : null}
                </td>
              </ClickRow>
            );
          })}
        </tbody>
      </Table>
    </Panel>
  );
}
