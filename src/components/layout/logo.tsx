import { getTranslations } from "next-intl/server";

import { cn } from "@/lib/utils";

// The Oral Care logo with "Digital", on the middle line of the logo's lower
// case letters (plan 4.3). Large on the sign-in pages, small in the menu.
export async function Logo({ size }: { size: "small" | "large" }) {
  const t = await getTranslations("app");
  const large = size === "large";
  return (
    <div className={cn("flex items-center", large ? "gap-3" : "gap-2.5")}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG from public/, no optimisation needed */}
      <img src="/logo.svg" alt={t("logoAlt")} className={cn("block w-auto", large ? "h-6.5" : "h-5.5")} />
      <span
        aria-hidden="true"
        className={cn("relative w-px bg-border", large ? "top-1 h-5" : "top-0.75 h-4")}
      />
      <span
        className={cn(
          "relative top-0.5 leading-none text-muted-foreground",
          large ? "text-paragraph-large" : "text-paragraph-small",
        )}
      >
        {t("product")}
      </span>
    </div>
  );
}
