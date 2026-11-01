"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { authClient } from "@/components/sign-in/auth-client";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const t = useTranslations("frame");
  const router = useRouter();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title={t("signOut")}
      aria-label={t("signOut")}
      className="text-muted-foreground"
      onClick={async () => {
        await authClient.signOut();
        router.replace("/sign-in");
        router.refresh();
      }}
    >
      <LogOut aria-hidden="true" />
    </Button>
  );
}
