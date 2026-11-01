import { STOCKHOLM } from "@/lib/time";

// Times and dates in the e-mails, always in the market's time zone and never
// in the computer's own (plan 5.4).

const formatter =
  (options: Intl.DateTimeFormatOptions) =>
  (instant: Date, timeZone: string = STOCKHOLM) =>
    new Intl.DateTimeFormat("en-GB", { timeZone, ...options }).format(instant);

/** 08:04 */
export const clock = formatter({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Sat 31 Oct */
export const shortDay = formatter({ weekday: "short", day: "numeric", month: "short" });

/** Saturday 31 October */
export const longDay = formatter({ weekday: "long", day: "numeric", month: "long" });
