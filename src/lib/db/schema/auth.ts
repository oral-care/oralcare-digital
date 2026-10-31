import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { country } from "./core";

// Better Auth's tables in snake_case, plus our own (plan 10.2). Property names
// are what Better Auth expects; the columns are snake_case.

export const auth = pgSchema("auth");

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// The view keys, the same as in the addresses (plan 3.3).
export const VIEW_KEYS = [
  "availability",
  "booking-statistics",
  "nps",
  "funnel",
  "tracking-framework",
  "monitoring",
] as const;
export type ViewKey = (typeof VIEW_KEYS)[number];

export const ROLES = ["viewer", "admin"] as const;
export type Role = (typeof ROLES)[number];

const viewKeyList = sql.raw(VIEW_KEYS.map((key) => `'${key}'`).join(", "));

export const users = auth.table(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    role: text("role").notNull().default("viewer"),
    external: boolean("external").notNull().default(false),
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
  },
  (t) => [
    check("users_role", sql`${t.role} in ('viewer', 'admin')`),
    // Lets user_view carry `external` with a foreign key (plan 10.2).
    unique("users_id_external").on(t.id, t.external),
  ],
);

export const sessions = auth.table("sessions", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
});

export const accounts = auth.table("accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const verifications = auth.table("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Valid until the person signs in or is removed (plan 10.2).
export const invitation = auth.table(
  "invitation",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    email: text("email").notNull().unique(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    role: text("role").notNull(),
    views: text("views").array().notNull(),
    markets: text("markets").array().notNull(),
    invitedBy: text("invited_by"),
    createdAt: createdAt(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [check("invitation_role", sql`${t.role} in ('viewer', 'admin')`)],
);

// External accounts may only ever have tracking-framework, enforced here and
// not only in code (plan 10.2).
export const userView = auth.table(
  "user_view",
  {
    userId: text("user_id").notNull(),
    view: text("view").notNull(),
    external: boolean("external").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.view] }),
    foreignKey({ columns: [t.userId, t.external], foreignColumns: [users.id, users.external] })
      .onUpdate("cascade")
      .onDelete("cascade"),
    check("user_view_key", sql`${t.view} in (${viewKeyList})`),
    check("user_view_external_only_tracking", sql`not ${t.external} or ${t.view} = 'tracking-framework'`),
  ],
);

export const userMarket = auth.table(
  "user_market",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    countryId: smallint("country_id")
      .notNull()
      .references(() => country.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.countryId] })],
);

// Atomic counters for code requests and wrong attempts (plan 11).
export const loginThrottle = auth.table(
  "login_throttle",
  {
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key, t.windowStart] })],
);

export const emailSuppression = auth.table("email_suppression", {
  email: text("email").primaryKey(),
  reason: text("reason").notNull(),
  createdAt: createdAt(),
});

// No foreign key, so the log stays when a user is removed (plan 10.2).
export const auditEvent = auth.table("audit_event", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  event: text("event").notNull(),
  actorId: text("actor_id"),
  subjectId: text("subject_id"),
  subjectEmail: text("subject_email"),
  before: jsonb("before"),
  after: jsonb("after"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});
