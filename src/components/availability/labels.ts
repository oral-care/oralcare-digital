import type { FirstFree } from "@/lib/availability/views";

// Shared texts for the tables, given the "availability" translations.

type T = (key: string, values?: Record<string, string | number>) => string;

/** Today, 1 day, {N} days or None in 30 days (plan 5.4). */
export function waitText(t: T, first: FirstFree): string {
  if (first === "none") return t("wait.none");
  return first.days === 0 ? t("wait.today") : t("wait.days", { count: first.days });
}
