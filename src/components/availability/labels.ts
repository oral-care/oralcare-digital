import type { ClinicStatuses } from "@/lib/availability/figures";
import type { FirstFree } from "@/lib/availability/views";
import { shortDate } from "@/lib/time";

// Shared texts for the tables, given the "availability" translations.

type T = (key: string, values?: Record<string, string | number>) => string;

/** Today, 1 day, {N} days or None in {N} days, where N is how far oralcare.se was searched (plan 5.4). */
export function waitText(t: T, first: FirstFree): string {
  if ("noneIn" in first) return t("wait.none", { count: first.noneIn });
  return first.days === 0 ? t("wait.today") : t("wait.days", { count: first.days });
}

/** First slot 7 Dec: not online, but bookable later (plan 5.1). */
export function firstSlotText(t: T, day: string): string {
  return t("status.later", { day: shortDate(day) });
}

/** A clinic's availability as its badge says it. */
export function availabilityText(t: T, statuses: ClinicStatuses): string {
  return statuses.availability === "later" && statuses.firstSlot
    ? firstSlotText(t, statuses.firstSlot)
    : t(`status.${statuses.availability}`);
}
