import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { UsersPage } from "@/components/users/users-page";
import type { UserListRow } from "@/components/users/types";
import { removeAction, inviteAction, updateAction } from "@/lib/users/actions";
import { listUsers } from "@/lib/users/data";
import { clock, shortDay } from "@/lib/email/format";
import { MARKETS, MARKET_CODES } from "@/lib/markets";
import { MODULES } from "@/lib/modules";
import { STOCKHOLM, zonedDay } from "@/lib/time";

import { requireAdmin } from "../../access";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("users");
  return { title: t("heading") };
}

// Users (plan 4.9): who can sign in, which views they can open and which
// markets they see. Admins only; the list covers every market.
export default async function Users({ params }: { params: Promise<{ market: string }> }) {
  const { viewer } = await requireAdmin((await params).market);
  const t = await getTranslations("users");
  const users = (await listUsers()) ?? [];
  const today = zonedDay(new Date(), STOCKHOLM);

  const viewNames = (keys: string[]) =>
    keys.length === MODULES.length
      ? t("allViews")
      : MODULES.filter((m) => keys.includes(m.key))
          .map((m) => m.name)
          .join(", ");
  const marketNames = (codes: string[]) =>
    codes.length === MARKET_CODES.length
      ? t("allMarkets")
      : MARKETS.filter((m) => codes.includes(m.code))
          .map((m) => m.name)
          .join(", ");

  const rows: UserListRow[] = users.map((user) => ({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    initials: `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase(),
    role: user.role,
    views: user.views,
    markets: user.markets,
    accessText: viewNames(user.views),
    marketsText: marketNames(user.markets),
    lastSignIn:
      user.invited || !user.lastSignInAt
        ? t("invited")
        : zonedDay(user.lastSignInAt, STOCKHOLM) === today
          ? t("lastSignInToday", { time: clock(user.lastSignInAt, STOCKHOLM) })
          : shortDay(user.lastSignInAt, STOCKHOLM),
    isSelf: user.id === viewer.id,
  }));

  return (
    <UsersPage
      rows={rows}
      views={MODULES.map((m) => ({ key: m.key, name: m.name }))}
      markets={MARKETS.map((m) => ({ code: m.code, name: m.name, domain: m.emailDomain }))}
      actions={{ invite: inviteAction, update: updateAction, remove: removeAction }}
    />
  );
}
