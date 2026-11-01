import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { clinic, country, jobRun, sourceSystem, treatment } from "./core";

// The Availability module (plan 10.3). Columns are named after the source's
// role (web, epr), not after oralcare.se and Muntra, so another market with
// another booking system uses the same tables.

export const availability = pgSchema("availability");

const runId = () =>
  bigint("job_run_id", { mode: "number" })
    .notNull()
    .references(() => jobRun.id);
const clinicId = () =>
  integer("clinic_id")
    .notNull()
    .references(() => clinic.id);
const treatmentId = () =>
  integer("treatment_id")
    .notNull()
    .references(() => treatment.id);
const sourceSystemId = () =>
  smallint("source_system_id")
    .notNull()
    .references(() => sourceSystem.id);

export const MEASUREMENT_STATUSES = ["measured", "not_offered", "could_not_be_measured"] as const;

export const measurement = availability.table(
  "measurement",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    jobRunId: runId(),
    clinicId: clinicId(),
    treatmentId: treatmentId(),
    sourceSystemId: sourceSystemId(),
    status: text("status").notNull(),
    // Why a value could not be measured, as a code (deadline, incident, http_429, ...).
    reason: text("reason"),
    slots7: integer("slots_7"),
    slots14: integer("slots_14"),
    slots30: integer("slots_30"),
    firstFreeAt: timestamp("first_free_at", { withTimezone: true }),
    caregiversActivated: integer("caregivers_activated"),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (t) => [
    check("measurement_status", sql`${t.status} in ('measured', 'not_offered', 'could_not_be_measured')`),
    uniqueIndex("measurement_run_pair_source").on(t.jobRunId, t.clinicId, t.treatmentId, t.sourceSystemId),
  ],
);

export const comparison = availability.table(
  "comparison",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    jobRunId: runId(),
    clinicId: clinicId(),
    treatmentId: treatmentId(),
    webSlots: integer("web_slots"),
    eprSlots: integer("epr_slots"),
    slotsNotOnline: integer("slots_not_online"),
  },
  (t) => [
    uniqueIndex("comparison_run_pair").on(t.jobRunId, t.clinicId, t.treatmentId),
    // Patient vs Muntra reads a pair's history for "Since" (plan 4.7).
    index("comparison_pair").on(t.clinicId, t.treatmentId),
  ],
);

// Start times as minutes from the window start, without caregivers. Kept 90 days.
export const slotList = availability.table(
  "slot_list",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    jobRunId: runId(),
    clinicId: clinicId(),
    treatmentId: treatmentId(),
    sourceSystemId: sourceSystemId(),
    startMinutes: integer("start_minutes").array().notNull(),
  },
  (t) => [
    uniqueIndex("slot_list_run_pair_source").on(t.jobRunId, t.clinicId, t.treatmentId, t.sourceSystemId),
  ],
);

// Thresholds per market and treatment with history, keyed on the web key so
// they can be set before the treatment is first read. A null key is the default
// for "other treatments" (plan 5.2).
export const statusThresholdVersion = availability.table("status_threshold_version", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  countryId: smallint("country_id")
    .notNull()
    .references(() => country.id),
  treatmentWebKey: text("treatment_web_key"),
  goodMinSlots: integer("good_min_slots").notNull(),
  shortMaxDays: integer("short_max_days").notNull(),
  validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
});

export const dailyValue = availability.table(
  "daily_value",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    day: date("day").notNull(),
    clinicId: clinicId(),
    treatmentId: treatmentId(),
    sourceSystemId: sourceSystemId(),
    jobRunId: runId(),
    isLate: boolean("is_late").notNull().default(false),
    status: text("status").notNull(),
    slots14: integer("slots_14"),
    firstFreeDays: integer("first_free_days"),
    availability: text("availability"),
    waitingTime: text("waiting_time"),
    thresholdVersionId: integer("threshold_version_id").references(() => statusThresholdVersion.id),
    codeVersion: text("code_version").notNull(),
  },
  (t) => [
    uniqueIndex("daily_value_day_pair_source").on(t.day, t.clinicId, t.treatmentId, t.sourceSystemId),
    check("daily_value_availability", sql`${t.availability} is null or ${t.availability} in ('good', 'low')`),
    check("daily_value_waiting_time", sql`${t.waitingTime} is null or ${t.waitingTime} in ('short', 'long')`),
  ],
);

export const dailySlotList = availability.table("daily_slot_list", {
  dailyValueId: bigint("daily_value_id", { mode: "number" })
    .primaryKey()
    .references(() => dailyValue.id),
  startMinutes: integer("start_minutes").array().notNull(),
});

export const siteIncident = availability.table("site_incident", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  jobRunId: runId(),
  shareMissing: numeric("share_missing", { precision: 5, scale: 4 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Changes in the offering, stored as facts without assessment (plan 6.5).
export const changeEvent = availability.table("change_event", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  countryId: smallint("country_id")
    .notNull()
    .references(() => country.id),
  kind: text("kind").notNull(),
  clinicId: integer("clinic_id").references(() => clinic.id),
  treatmentId: integer("treatment_id").references(() => treatment.id),
  before: jsonb("before"),
  after: jsonb("after"),
  fromRunId: bigint("from_run_id", { mode: "number" }).references(() => jobRun.id),
  toRunId: bigint("to_run_id", { mode: "number" })
    .notNull()
    .references(() => jobRun.id),
  eprSlots: integer("epr_slots"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
