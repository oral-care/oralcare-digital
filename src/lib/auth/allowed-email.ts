import { MARKETS, type MarketCode } from "@/lib/markets";

// Which addresses we accept (plan 3.1 and 11): lower case, plain ASCII without
// plus signs or quotes. The domain only marks an account as external and
// suggests a market. Pure module.

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
