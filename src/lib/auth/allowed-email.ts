import { MARKETS, type MarketCode } from "@/lib/markets";

// Which addresses may get a sign-in code (plan 3.1 and 11): lower case, plain
// ASCII without plus signs or quotes, and exactly one of the group's domains,
// or an invitation that only gives Tracking Framework. Pure module.

const SHAPE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/** The address in lower case, or null if it isn't a plain address we accept. */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || /[^\x21-\x7e]/.test(email) || /[+"']/.test(email)) return null;
  return SHAPE.test(email) ? email : null;
}

const domainOf = (email: string) => email.slice(email.lastIndexOf("@") + 1);

export function isGroupEmail(email: string): boolean {
  return MARKETS.some((m) => m.emailDomain === domainOf(email));
}

/** The market the address's domain suggests when an admin invites it (plan 3.4). */
export function marketForEmail(email: string): MarketCode | null {
  return MARKETS.find((m) => m.emailDomain === domainOf(email))?.code ?? null;
}

/**
 * The normalized address if it may sign in: a group address, or an outside
 * address whose invitation only gives Tracking Framework.
 */
export function isAllowedEmail(raw: string, options: { trackingOnlyInvitation: boolean }): string | null {
  const email = normalizeEmail(raw);
  if (!email) return null;
  return isGroupEmail(email) || options.trackingOnlyInvitation ? email : null;
}
