import { alertLine, type AlertLine } from "@/lib/alerts/lines";
import { byOrder, type StoredAlert } from "@/lib/alerts/types";
import { t } from "@/lib/messages";
import { STOCKHOLM, zonedDay } from "@/lib/time";

import { clock, longDay, shortDay } from "./format";
import {
  alertRows,
  button,
  code,
  facts,
  heading,
  label,
  list,
  paragraph,
  render,
  stats,
  type Block,
  type Email,
  type ListRow,
} from "./layout";

// The four e-mails (plan 9.1). Each returns subject, preheader, HTML and plain
// text. Pure module, tested with snapshots.

export function signInCodeEmail(input: { code: string }): Email {
  return render({
    subject: t("email.signIn.subject"),
    preheader: t("email.signIn.preheader"),
    blocks: [heading(t("email.signIn.heading")), paragraph(t("email.signIn.text")), code(input.code)],
    why: t("email.signIn.why"),
  });
}

export function invitationEmail(input: {
  adminName: string;
  firstName: string;
  markets: string[];
  role: "viewer" | "admin";
  email: string;
}): Email {
  const markets = input.markets.join(", ");
  const role = t(`email.invitation.roles.${input.role}`);
  return render({
    subject: t("email.invitation.subject", { admin: input.adminName }),
    preheader: t("email.invitation.preheader", { markets, role: role.toLowerCase() }),
    blocks: [
      heading(t("email.invitation.heading", { firstName: input.firstName })),
      facts([
        { label: t("email.invitation.markets"), value: markets },
        { label: t("email.invitation.role"), value: role },
        { label: t("email.invitation.signInWith"), value: input.email },
      ]),
      button(t("email.invitation.button")),
      paragraph(t("email.invitation.noPasswords"), { muted: true, marginTop: 28 }),
    ],
    why: t("email.invitation.why"),
  });
}

/** One e-mail with every new alert from a measurement, most serious first (plan 8.1). */
export function alertEmail(input: {
  alerts: StoredAlert[];
  measuredAt: Date;
  now: Date;
  timeZone?: string;
}): Email {
  const timeZone = input.timeZone ?? STOCKHOLM;
  const lines = [...input.alerts].sort(byOrder).map((alert) => alertLine(alert, timeZone));
  const [first] = lines;
  if (!first) throw new Error("An alert e-mail needs at least one alert");
  const time = clock(input.measuredAt, timeZone);
  const today = zonedDay(input.measuredAt, timeZone) === zonedDay(input.now, timeZone);
  return render({
    subject:
      lines.length === 1
        ? first.headline
        : t("email.alerts.subjectMore", { first: first.headline, count: lines.length - 1 }),
    preheader: lines.length === 1 ? first.fact : t("email.alerts.preheader", { count: lines.length, time }),
    blocks: [
      label(
        today
          ? t("email.alerts.measuredToday", { time })
          : t("email.alerts.measuredOn", { date: shortDay(input.measuredAt, timeZone), time }),
      ),
      heading(t("email.alerts.heading", { count: lines.length }), 8),
      alertRows(lines),
      button(t("email.open")),
    ],
    why: t("email.whyAdmin"),
  });
}

export type StatusCounts<K extends string> = Record<K | "mixed" | "notOnline", number>;

export type MarketSummary = {
  name: string;
  availability: StatusCounts<"good" | "low">;
  waitingTime: StatusCounts<"short" | "long">;
  /** Clinics with slots in the booking system that patients can't book. */
  slotsNotOnline: number;
};

export type SummaryData = {
  /** Any instant on the day the summary is about. */
  day: Date;
  measurements: { ran: number; expected: number };
  /** Measured share of expected pairs and sources, 0-100, or null when nothing ran. */
  coverage: number | null;
  backupDone: boolean;
  attention: AlertLine[];
  markets: MarketSummary[];
  changes: string[];
  serverErrors: number;
  usage: {
    jobs: { ran: number; expected: number };
    neonDatabasePercent: number;
    neonTrafficPercent: number | null;
    resendSent: number;
    /** Shown on Hobby only, where it has a monthly budget. */
    vercelCpuPercent: number | null;
  };
  timeZone?: string;
};

const MAX_CHANGES = 10;

export function summaryEmail(data: SummaryData): Email {
  const timeZone = data.timeZone ?? STOCKHOLM;
  const missing = data.measurements.expected - data.measurements.ran;
  const headline =
    missing > 0 ? t("email.summary.someMissing", { count: missing }) : t("email.summary.allRan");
  const clinics = (count: number) => t("email.summary.clinics", { count });
  const coverage = data.coverage === null ? "-" : `${Math.floor(data.coverage)}%`;

  const blocks: Block[] = [
    label(longDay(data.day, timeZone)),
    heading(headline, 8),
    stats([
      {
        label: t("email.summary.measurements"),
        value: String(data.measurements.ran),
        suffix: t("email.summary.of", { count: data.measurements.expected }),
      },
      { label: t("email.summary.coverage"), value: coverage },
      {
        label: t("email.summary.backup"),
        value: t(data.backupDone ? "email.summary.backupDone" : "email.summary.backupMissing"),
      },
    ]),
  ];

  if (data.attention.length > 0) {
    blocks.push(label(t("email.summary.needsAttention"), 32), alertRows(data.attention, 8));
  }

  data.markets.forEach((market, index) => {
    const a = market.availability;
    const w = market.waitingTime;
    blocks.push(
      label(t("email.summary.availabilityIn", { market: market.name }), index === 0 ? 32 : 24),
      list([
        { label: t("email.summary.good"), value: clinics(a.good) },
        { label: t("email.summary.mixedAvailability"), value: clinics(a.mixed) },
        { label: t("email.summary.low"), value: clinics(a.low) },
        { label: t("email.summary.notOnline"), value: clinics(a.notOnline), muted: true },
      ]),
      label(t("email.summary.waitingTimeIn", { market: market.name }), 24),
      list([
        { label: t("email.summary.short"), value: clinics(w.short) },
        { label: t("email.summary.mixedWaitingTime"), value: clinics(w.mixed) },
        { label: t("email.summary.long"), value: clinics(w.long) },
        { label: t("email.summary.notOnline"), value: clinics(w.notOnline), muted: true },
      ]),
      label(t("email.summary.slotsNotOnline"), 24),
      list([
        {
          label: t("email.summary.slotsNotOnlineRow"),
          value: clinics(market.slotsNotOnline),
          attention: market.slotsNotOnline > 0,
        },
      ]),
    );
  });

  if (data.changes.length > 0) {
    const shown: ListRow[] = data.changes
      .slice(0, MAX_CHANGES)
      .map((change) => ({ label: change, value: "" }));
    if (data.changes.length > MAX_CHANGES) {
      shown.push({
        label: t("email.summary.moreChanges", { count: data.changes.length - MAX_CHANGES }),
        value: "",
        muted: true,
      });
    }
    blocks.push(label(t("email.summary.changes"), 32), list(shown));
  }

  if (data.serverErrors > 0) {
    blocks.push(
      label(t("email.summary.serverErrors"), 32),
      list([{ label: t("email.summary.serverErrorsRow", { count: data.serverErrors }), value: "" }]),
    );
  }

  const u = data.usage;
  const usage: ListRow[] = [
    {
      label: t("email.summary.scheduledJobs"),
      value: t("email.summary.scheduledJobsValue", { ran: u.jobs.ran, expected: u.jobs.expected }),
      muted: true,
    },
    {
      label: t("email.summary.neonDatabase"),
      value: t("email.summary.percentOf", { percent: u.neonDatabasePercent, limit: "1 GB" }),
      muted: true,
    },
  ];
  if (u.neonTrafficPercent !== null) {
    usage.push({
      label: t("email.summary.neonTraffic"),
      value: t("email.summary.percentOf", { percent: u.neonTrafficPercent, limit: "5 GB" }),
      muted: true,
    });
  }
  usage.push({
    label: t("email.summary.resendEmails"),
    value: t("email.summary.resendEmailsValue", { sent: u.resendSent, limit: 100 }),
    muted: true,
  });
  if (u.vercelCpuPercent !== null) {
    usage.push({
      label: t("email.summary.vercelCpu"),
      value: t("email.summary.percentOf", { percent: u.vercelCpuPercent, limit: "4 hours" }),
      muted: true,
    });
  }
  blocks.push(label(t("email.summary.servicesAndUsage"), 32), list(usage), button(t("email.open")));

  return render({
    subject: t("email.summary.subject", {
      date: shortDay(data.day, timeZone),
      headline: headline.charAt(0).toLowerCase() + headline.slice(1),
    }),
    preheader: t("email.summary.preheader", {
      measured: data.measurements.ran,
      expected: data.measurements.expected,
      coverage: data.coverage === null ? 0 : Math.floor(data.coverage),
      backup: t(
        data.backupDone ? "email.summary.preheaderBackupDone" : "email.summary.preheaderBackupMissing",
      ),
    }),
    blocks,
    why: t("email.whyAdmin"),
  });
}
