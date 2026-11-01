import { clock, shortDay } from "@/lib/email/format";
import { t } from "@/lib/messages";
import { STOCKHOLM } from "@/lib/time";

import type { StoredAlert } from "./types";

// The headline and the fact line of each alert (plan 8.1 and 8.2). Field
// paths and error codes are shown, never values from the sources. Pure module.

export type AlertLine = { headline: string; fact: string };

const text = (value: unknown) => (typeof value === "string" || typeof value === "number" ? value : "");
const instant = (value: unknown) =>
  typeof value === "string" || value instanceof Date ? new Date(value) : null;

export function alertLine(alert: StoredAlert, timeZone: string = STOCKHOLM): AlertLine {
  const p = alert.payload;
  const key = (part: string) => `alerts.${alert.type}.${part}`;
  const time = (value: unknown) => {
    const at = instant(value);
    return at ? clock(at, timeZone) : "";
  };
  const pointTime = time(p.point ?? alert.point);

  switch (alert.type) {
    case "measurement_failed":
      return {
        headline: t(key("headline"), { time: pointTime }),
        fact: t(key("fact"), { retryTime: time(p.retryAt), error: text(p.error) }),
      };
    case "schema_version":
      return {
        headline: t(key("headline"), { time: pointTime }),
        fact: t(key("fact"), { database: text(p.database), code: text(p.code) }),
      };
    case "stopped_early":
      return {
        headline: t(key("headline"), { time: pointTime }),
        fact: t(key(p.reason === "failures" ? "factFailures" : "factBudget")),
      };
    case "collector_error":
      return {
        headline: t(
          key(p.variant === "slot_before_window" ? "headlineSlotBeforeWindow" : "headlineRejected"),
        ),
        fact: t(key("fact"), { treatment: text(p.treatment), clinic: text(p.clinic) }),
      };
    case "missing_measurements": {
      const points = Array.isArray(p.points) ? p.points : [];
      return {
        headline: t(key("headline"), { count: points.length }),
        fact: t(key("fact"), { times: points.map(time).join(", ") }),
      };
    }
    case "backup_old": {
      const last = instant(p.lastFinishedAt);
      if (!last) return { headline: t(key("headlineNone")), fact: t(key("factNone")) };
      return {
        headline: t(key("headline"), { hours: text(p.hours) }),
        fact: t(key("fact"), { time: `${shortDay(last, timeZone)} ${clock(last, timeZone)}` }),
      };
    }
    case "vercel_token":
      return {
        headline: t(key("headline"), { date: shortDay(new Date(`${text(p.date)}T12:00:00Z`), timeZone) }),
        fact: t(key("fact")),
      };
    case "sign_in_limit":
      return { headline: t(key("headline"), { time: time(p.at) }), fact: t(key("fact")) };
    default: {
      // Every other alert fills its lines straight from the payload.
      const values = Object.fromEntries(Object.entries(p).map(([name, value]) => [name, text(value)]));
      return { headline: t(key("headline"), values), fact: t(key("fact"), values) };
    }
  }
}
