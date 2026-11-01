// The events in auth.audit_event (plan 3.4, 10.2 and 11), shared by sign-in,
// user management and the guard's pruning. Sign-in events are kept 90 days and
// admin events 12 months (plan 10.4). Pure module.

export const SIGN_IN_EVENTS = ["sign_in.succeeded", "sign_in.failed", "sign_in.blocked"] as const;
export const ADMIN_EVENTS = ["user.invited", "user.updated", "user.removed"] as const;

export type SignInEvent = (typeof SIGN_IN_EVENTS)[number];
export type AdminEvent = (typeof ADMIN_EVENTS)[number];
export type AuditEvent = SignInEvent | AdminEvent;

/** Why a user was removed, in the user.removed event's "before". */
export const REMOVED_INACTIVE = "inactive_12_months";
