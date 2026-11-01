"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { authClient, EMAIL_KEY } from "./auth-client";

// Step 1 (plan 4.2): the work e-mail. Every address gets the same answer;
// only invited ones get a code. The address waits in sessionStorage for the
// next step, never in the URL.
export function EmailForm() {
  const t = useTranslations("signIn");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "")
      .trim()
      .toLowerCase();
    if (!email.includes("@")) {
      setError(t("errors.email"));
      return;
    }
    setPending(true);
    setError(null);
    const { error: failed } = await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
    setPending(false);
    if (failed) {
      setError(t(failed.status === 400 ? "errors.email" : "errors.failed"));
      return;
    }
    sessionStorage.setItem(EMAIL_KEY, email);
    router.push("/sign-in/code");
  }

  return (
    <form onSubmit={submit} noValidate className="flex w-full flex-col gap-6">
      <Input
        name="email"
        type="email"
        placeholder={t("email")}
        aria-label={t("email")}
        autoComplete="email"
        required
        autoFocus
        aria-invalid={error ? true : undefined}
        className="h-11 px-4 py-0"
      />
      {error ? (
        <p role="alert" className="-mt-3 text-center text-paragraph-xs text-attention">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="h-11 w-full">
        {t("continue")}
      </Button>
    </form>
  );
}
