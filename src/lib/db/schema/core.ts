import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Shared by every module (plan 10.1). Validity periods are tstzrange columns;
// the exclusion constraints that stop them overlapping are in a hand-written
// migration, since Drizzle Kit can't express EXCLUDE.

export const core = pgSchema("core");

export const tstzrange = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tstzrange";
  },
});

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const validDuring = () =>
  tstzrange("valid_during")
    .notNull()
    .default(sql`tstzrange(now(), null)`);

export const country = core.table("country", {
  id: smallint("id").primaryKey().generatedAlwaysAsIdentity(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  brand: text("brand").notNull(),
  timeZone: text("time_zone").notNull(),
});

export const sourceSystem = core.table(
  "source_system",
  {
    id: smallint("id").primaryKey().generatedAlwaysAsIdentity(),
    key: text("key").notNull().unique(),
    role: text("role").notNull(),
    name: text("name").notNull(),
  },
  (t) => [check("source_system_role", sql`${t.role} in ('web', 'epr')`)],
);

export const marketSource = core.table(
  "market_source",
  {
    countryId: smallint("country_id")
      .notNull()
      .references(() => country.id),
    sourceSystemId: smallint("source_system_id")
      .notNull()
      .references(() => sourceSystem.id),
  },
  (t) => [primaryKey({ columns: [t.countryId, t.sourceSystemId] })],
);

export const region = core.table(
  "region",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    countryId: smallint("country_id")
      .notNull()
      .references(() => country.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("region_country_key").on(t.countryId, t.key)],
);

export const clinic = core.table("clinic", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  countryId: smallint("country_id")
    .notNull()
    .references(() => country.id),
  createdAt: createdAt(),
});

export const clinicName = core.table("clinic_name", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clinicId: integer("clinic_id")
    .notNull()
    .references(() => clinic.id),
  name: text("name").notNull(),
  city: text("city").notNull(),
  validDuring: validDuring(),
});

export const clinicExternalId = core.table("clinic_external_id", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clinicId: integer("clinic_id")
    .notNull()
    .references(() => clinic.id),
  sourceSystemId: smallint("source_system_id")
    .notNull()
    .references(() => sourceSystem.id),
  externalId: text("external_id").notNull(),
  validDuring: validDuring(),
});

export const clinicRegion = core.table("clinic_region", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clinicId: integer("clinic_id")
    .notNull()
    .references(() => clinic.id),
  regionId: integer("region_id")
    .notNull()
    .references(() => region.id),
  validDuring: validDuring(),
});

export const treatment = core.table(
  "treatment",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    countryId: smallint("country_id")
      .notNull()
      .references(() => country.id),
    webKey: text("web_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("treatment_country_web_key").on(t.countryId, t.webKey)],
);

export const treatmentName = core.table("treatment_name", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  treatmentId: integer("treatment_id")
    .notNull()
    .references(() => treatment.id),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  validDuring: validDuring(),
});

export const treatmentEprProcedure = core.table("treatment_epr_procedure", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clinicId: integer("clinic_id")
    .notNull()
    .references(() => clinic.id),
  treatmentId: integer("treatment_id")
    .notNull()
    .references(() => treatment.id),
  sourceSystemId: smallint("source_system_id")
    .notNull()
    .references(() => sourceSystem.id),
  procedureId: text("procedure_id").notNull(),
  validDuring: validDuring(),
});

export const clinicTreatmentOffering = core.table("clinic_treatment_offering", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clinicId: integer("clinic_id")
    .notNull()
    .references(() => clinic.id),
  treatmentId: integer("treatment_id")
    .notNull()
    .references(() => treatment.id),
  webSelectable: boolean("web_selectable").notNull(),
  eprActivated: boolean("epr_activated").notNull(),
  validDuring: validDuring(),
});

export const JOB_RUN_STATUSES = ["running", "succeeded", "failed", "skipped", "deferred"] as const;

// The run log for every job (plan 7). Two partial unique indexes make the lock:
// one per job, market and schedule point, and one running run per job and market.
// The market is coalesced so jobs without one (guard, backup) lock too.
export const jobRun = core.table(
  "job_run",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    job: text("job").notNull(),
    countryId: smallint("country_id").references(() => country.id),
    schedulePoint: timestamp("schedule_point", { withTimezone: true }),
    attempt: smallint("attempt").notNull().default(1),
    isRetry: boolean("is_retry").notNull().default(false),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    delayMs: integer("delay_ms"),
    windowStart: timestamp("window_start", { withTimezone: true }),
    codeVersion: text("code_version").notNull(),
    schemaVersion: integer("schema_version"),
    durationMs: integer("duration_ms"),
    cpuMs: integer("cpu_ms"),
    requestCount: integer("request_count"),
    bytes: bigint("bytes", { mode: "number" }),
    errorCodes: text("error_codes").array(),
    // Counts and codes only. Never source responses or personal data (plan 12).
    details: jsonb("details"),
  },
  (t) => [
    check("job_run_status", sql`${t.status} in ('running', 'succeeded', 'failed', 'skipped', 'deferred')`),
    uniqueIndex("job_run_point_lock")
      .on(t.job, sql`coalesce(${t.countryId}, 0)`, t.schedulePoint)
      .where(sql`${t.status} in ('running', 'succeeded')`),
    uniqueIndex("job_run_one_running")
      .on(t.job, sql`coalesce(${t.countryId}, 0)`)
      .where(sql`${t.status} = 'running'`),
  ],
);

// One row, set by the migrations (plan 7).
export const schemaState = core.table(
  "schema_state",
  {
    id: boolean("id").primaryKey().default(true),
    schemaVersion: integer("schema_version").notNull(),
    minCodeSchema: integer("min_code_schema").notNull(),
  },
  (t) => [check("schema_state_single_row", sql`${t.id}`)],
);

export const configVersion = core.table(
  "config_version",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    key: text("key").notNull(),
    value: jsonb("value"),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    note: text("note"),
  },
  (t) => [uniqueIndex("config_version_key_from").on(t.key, t.validFrom)],
);

export const ALERT_STATUSES = ["pending", "sent", "failed"] as const;
export const ALERT_SENT_WITH = ["alert", "summary"] as const;

// Alerts from every module, saved in the run's transaction and sent after it
// (plan 8.1). The dedupe key makes one event alert once.
export const alert = core.table(
  "alert",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    type: text("type").notNull(),
    countryId: smallint("country_id").references(() => country.id),
    jobRunId: bigint("job_run_id", { mode: "number" }).references(() => jobRun.id),
    // Facts for the alert line, never personal data.
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: createdAt(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    attempts: smallint("attempts").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    // Sent in an alert e-mail or in the daily summary, so the cap of 3 alert
    // e-mails a day can be counted (plan 8.1).
    sentWith: text("sent_with"),
  },
  (t) => [
    check("alert_status", sql`${t.status} in ('pending', 'sent', 'failed')`),
    check("alert_sent_with", sql`${t.sentWith} is null or ${t.sentWith} in ('alert', 'summary')`),
  ],
);

// Counted per UTC day, type and recipient, only through core.reserve_email (plan 11).
export const emailSend = core.table(
  "email_send",
  {
    utcDay: date("utc_day").notNull(),
    type: text("type").notNull(),
    count: integer("count").notNull().default(0),
    // When the day's cap first refused a reservation, for the guard (plan 8.2).
    cappedAt: timestamp("capped_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.utcDay, t.type] }),
    check("email_send_type", sql`${t.type} in ('sign-in', 'invitation', 'alert', 'summary')`),
  ],
);

// Server errors without personal data (plan 12).
export const appError = core.table("app_error", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  route: text("route").notNull(),
  errorCode: text("error_code").notNull(),
  messageHash: text("message_hash").notNull(),
});
