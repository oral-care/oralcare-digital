import type { Role, ViewKey } from "@/lib/db/schema/auth";
import type { MarketCode } from "@/lib/markets";

// What the Users page gets from the server: rows ready to show, the choices
// in the form, and the server actions (plan 4.9).

export type UserListRow = {
  /** A user's id, or "invitation:{id}" for someone who hasn't signed in yet. */
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  initials: string;
  role: Role;
  views: ViewKey[];
  markets: MarketCode[];
  accessText: string;
  marketsText: string;
  lastSignIn: string;
  isSelf: boolean;
};

export type AccessInput = {
  firstName: string;
  lastName: string;
  views: ViewKey[];
  markets: MarketCode[];
  role: Role;
};

export type ActionResult = { ok: true } | { ok: false; errors: Partial<Record<string, string>> };

export type UserActions = {
  invite: (input: AccessInput & { email: string }) => Promise<ActionResult>;
  update: (id: string, input: AccessInput) => Promise<ActionResult>;
  remove: (id: string) => Promise<ActionResult>;
};

export type ViewOption = { key: ViewKey; name: string };
export type MarketOption = { code: MarketCode; name: string; domain: string };
