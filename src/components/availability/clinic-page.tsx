import { ArrowLeft, Check, X } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { HeaderTip } from "@/components/data-table/header-tip";
import { CELL, ROW, Table } from "@/components/data-table/table";
import type { ClinicStatuses } from "@/lib/availability/figures";
import { formatCount } from "@/lib/availability/format";
import type { ClinicTreatmentRow } from "@/lib/availability/views";
import { cn } from "@/lib/utils";

import { waitText } from "./labels";
import { Panel } from "./section";
import { availabilityTone, StatusBadge, waitingTone } from "./status-badge";

// A clinic's page (plan 4.6): the heading with its statuses, and the table
// with every treatment on oralcare.se.

export async function ClinicHeader({
  name,
  city,
  region,
  statuses,
  backHref,
}: {
  name: string;
  city: string;
  region: string;
  statuses: ClinicStatuses;
  backHref: string;
}) {
  const t = await getTranslations("availability");
  const availability = availabilityTone(statuses.availability);
  const waiting = waitingTone(statuses.waitingTime);
  return (
    <div className="mb-6">
      <Link
        href={backHref}
        className="mb-3 inline-flex items-center gap-1.5 text-paragraph-small text-muted-foreground no-underline focus-ring hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t("clinic.back")}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-h3">{name}</h1>
        {statuses.availability === "notOnline" ? (
          <StatusBadge tone="neutral">{t("status.notOnline")}</StatusBadge>
        ) : (
          <>
            {availability ? (
              <StatusBadge tone={availability}>
                {t("clinic.availability", { status: t(`status.${statuses.availability}`) })}
              </StatusBadge>
            ) : null}
            {waiting ? (
              <StatusBadge tone={waiting}>
                {t("clinic.waitingTime", { status: t(`status.${statuses.waitingTime}`) })}
              </StatusBadge>
            ) : null}
          </>
        )}
      </div>
      <p className="mt-2 text-paragraph-small text-muted-foreground">{t("clinic.place", { city, region })}</p>
    </div>
  );
}

function YesNo({ yes, children }: { yes: boolean; children: React.ReactNode }) {
  const Icon = yes ? Check : X;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap",
        yes ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {children}
    </span>
  );
}

export async function ClinicTreatmentsTable({ rows }: { rows: ClinicTreatmentRow[] }) {
  const t = await getTranslations("availability");
  const count = (value: number | "unknown" | null) =>
    value === null ? null : value === "unknown" ? t("na") : formatCount(value);
  return (
    <Panel>
      <Table>
        <thead>
          <tr>
            <HeaderTip label={t("columns.treatment")} tip={t("tips.clinicTreatment")} />
            <HeaderTip label={t("columns.site")} tip={t("tips.site")} />
            <HeaderTip label={t("columns.inMuntra")} tip={t("tips.inMuntra")} />
            <HeaderTip label={t("columns.slotsInMuntra")} tip={t("tips.slotsInMuntra")} />
            <HeaderTip label={t("columns.slotsNotOnline")} tip={t("tips.slotsNotOnline")} />
            <HeaderTip label={t("columns.firstFreeSlotOnline")} tip={t("tips.firstFreeSlot")} />
            <HeaderTip label={t("columns.availability")} tip={t("tips.availability")} alignRight />
            <HeaderTip label={t("columns.waitingTime")} tip={t("tips.waitingTime")} alignRight />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const online = row.site === "online";
            const first = row.firstFree;
            const waiting = row.waitingTime ? waitingTone(row.waitingTime) : null;
            return (
              <tr key={row.treatment.id} className={cn(ROW, !online && "text-muted-foreground")}>
                <td className={cn(CELL, online && "font-medium")}>{row.treatment.name}</td>
                <td className={CELL}>
                  {row.site === "unknown" ? (
                    t("na")
                  ) : (
                    <YesNo yes={online}>{online ? t("clinic.bookable") : t("status.notOnline")}</YesNo>
                  )}
                </td>
                <td className={CELL}>
                  {row.muntra === "unknown" ? (
                    t("na")
                  ) : (
                    <YesNo yes={row.muntra === "activated"}>
                      {row.muntra === "activated" ? t("clinic.activated") : t("clinic.notActivated")}
                    </YesNo>
                  )}
                </td>
                <td className={cn(CELL, "tabular-nums")}>{count(row.slotsInMuntra)}</td>
                <td className={cn(CELL, "tabular-nums")}>{count(row.slotsNotOnline)}</td>
                <td className={cn(CELL, "whitespace-nowrap")}>
                  {first === null
                    ? null
                    : first === "unknown"
                      ? t("na")
                      : first === "zero"
                        ? "0"
                        : waitText(t, first)}
                </td>
                <td className={CELL}>
                  {row.availability === null ? null : row.availability.kind === "slotsNotOnline" ? (
                    <StatusBadge tone="attention">
                      {t("clinic.slotsNotOnline", { count: row.availability.slots })}
                    </StatusBadge>
                  ) : row.availability.kind === "noSlotsInMuntra" ? (
                    <StatusBadge tone={row.availability.attention ? "attention" : "neutral"}>
                      {t("clinic.noSlotsInMuntra")}
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone={row.availability.kind}>
                      {t(`status.${row.availability.kind}`)}
                    </StatusBadge>
                  )}
                </td>
                <td className={CELL}>
                  {waiting && row.waitingTime ? (
                    <StatusBadge tone={waiting}>{t(`status.${row.waitingTime}`)}</StatusBadge>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Panel>
  );
}
