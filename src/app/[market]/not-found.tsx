import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { PageHead } from "@/components/layout/page-head";
import { Button } from "@/components/ui/button";
import { homePath, openViews } from "@/lib/auth/permissions";
import { getViewer } from "@/lib/auth/session";
import { moduleByKey } from "@/lib/modules";

// "Page not found" inside the frame (plan 4.10), with a button to the start page.
export default async function MarketNotFound() {
  const t = await getTranslations("notFound");
  const tn = await getTranslations("noAccess");
  const viewer = await getViewer();
  const view = viewer ? openViews(viewer)[0] : undefined;
  return (
    <>
      <PageHead title={t("heading")} />
      <Button asChild variant="outline">
        <Link href={viewer ? homePath(viewer) : "/sign-in"}>
          {viewer
            ? t("goTo", { page: view ? moduleByKey(view).pages[0]!.name : tn("heading") })
            : t("signIn")}
        </Link>
      </Button>
    </>
  );
}
