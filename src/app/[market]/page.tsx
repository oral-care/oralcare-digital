import { redirect } from "next/navigation";

import { homePath } from "@/lib/auth/permissions";

import { requireMarket } from "./access";

// /{market} goes to the user's first view in that market (plan 4.1).
export default async function MarketHome({
  params,
}: {
  params: Promise<{ market: string }>;
}): Promise<never> {
  const { viewer, market } = await requireMarket((await params).market);
  redirect(homePath(viewer, market));
}
