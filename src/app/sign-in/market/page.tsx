import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AuthShell } from "@/components/sign-in/auth-shell";
import { MarketList } from "@/components/sign-in/market-list";
import { homePath, openMarkets } from "@/lib/auth/permissions";
import { getViewer } from "@/lib/auth/session";
import { marketByCode } from "@/lib/markets";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("signIn");
  return { title: t("chooseMarket") };
}

// Step 3 (plan 3.3 and 4.2): someone with one market goes straight in.
export default async function SignInMarket() {
  const viewer = await getViewer();
  if (!viewer) redirect("/sign-in");
  const markets = openMarkets(viewer);
  if (markets.length <= 1) redirect(homePath(viewer));
  return (
    <AuthShell>
      <MarketList
        markets={markets.map((code) => {
          const market = marketByCode(code);
          return { code, name: market.name, brand: market.brand, href: homePath(viewer, code) };
        })}
      />
    </AuthShell>
  );
}
