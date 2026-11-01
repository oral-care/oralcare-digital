"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";

import { authClient, EMAIL_KEY } from "./auth-client";
import { AuthNote } from "./auth-shell";

const LENGTH = 8;
const noSubscription = () => () => undefined;

/** The message for an answer from the server, by its code (plan 11). */
function errorKey(error: { status: number; code?: string }): string {
  if (error.status === 429 || error.code === "SIGN_IN_LOCKED") return "errors.locked";
  if (error.code === "TOO_MANY_ATTEMPTS") return "errors.tooManyAttempts";
  if (error.code === "OTP_EXPIRED") return "errors.expired";
  if (error.code === "INVALID_OTP") return "errors.wrongCode";
  return "errors.failed";
}

// Step 2 (plan 4.2): eight boxes in two groups of four. The cursor moves to
// the next box, backspace in an empty box goes back, and pasting the code
// fills every box.
export function CodeForm() {
  const t = useTranslations("signIn");
  const router = useRouter();
  // True only in the browser after hydration, where sessionStorage exists.
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const email = hydrated ? sessionStorage.getItem(EMAIL_KEY) : null;
  const [digits, setDigits] = useState<string[]>(() => Array<string>(LENGTH).fill(""));
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  // Set when the code was right, so clearing the address doesn't send the user back to step 1.
  const signedIn = useRef(false);
  useEffect(() => {
    if (hydrated && !email && !signedIn.current) router.replace("/sign-in");
  }, [hydrated, email, router]);

  const focus = (index: number) => boxes.current[Math.max(0, Math.min(LENGTH - 1, index))]?.focus();

  function fill(from: number, text: string) {
    const numbers = text
      .replace(/\D/g, "")
      .slice(0, LENGTH - from)
      .split("");
    if (numbers.length === 0) return;
    setDigits((current) =>
      current.map((d, i) => (i >= from && i < from + numbers.length ? numbers[i - from]! : d)),
    );
    focus(from + numbers.length);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email) return;
    const otp = digits.join("");
    if (otp.length !== LENGTH) {
      setError(t("errors.code"));
      return;
    }
    setPending(true);
    setError(null);
    setNote(null);
    const { error: failed } = await authClient.signIn.emailOtp({ email, otp });
    setPending(false);
    if (failed) {
      setError(t(errorKey(failed)));
      setDigits(Array<string>(LENGTH).fill(""));
      focus(0);
      return;
    }
    signedIn.current = true;
    sessionStorage.removeItem(EMAIL_KEY);
    router.replace("/sign-in/market");
    router.refresh();
  }

  async function resend() {
    if (!email) return;
    setError(null);
    const { error: failed } = await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
    if (failed) setError(t("errors.failed"));
    else setNote(t("newCodeSent"));
    focus(0);
  }

  if (!email) return null;
  return (
    <>
      <AuthNote>{t("codeSent", { email })}</AuthNote>
      <form onSubmit={submit} noValidate className="flex w-full flex-col gap-6">
        <div className="flex justify-center gap-1.5">
          {digits.map((digit, i) => (
            <Fragment key={i}>
              {i === LENGTH / 2 ? <span aria-hidden="true" className="w-2" /> : null}
              <input
                ref={(element) => {
                  boxes.current[i] = element;
                }}
                value={digit}
                inputMode="numeric"
                autoComplete={i === 0 ? "one-time-code" : "off"}
                aria-label={t("digit", { number: i + 1 })}
                autoFocus={i === 0}
                aria-invalid={error ? true : undefined}
                onChange={(event) => {
                  const value = event.target.value.replace(/\D/g, "");
                  if (value.length > 1) {
                    fill(i, value);
                    return;
                  }
                  setDigits((current) => current.map((d, j) => (j === i ? value : d)));
                  if (value) focus(i + 1);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Backspace" && !digits[i] && i > 0) {
                    event.preventDefault();
                    setDigits((current) => current.map((d, j) => (j === i - 1 ? "" : d)));
                    focus(i - 1);
                  }
                }}
                onPaste={(event) => {
                  event.preventDefault();
                  fill(0, event.clipboardData.getData("text"));
                }}
                className="h-12 w-9.5 rounded-lg bg-white text-center text-xl font-semibold inset-ring-1 inset-ring-border outline-none focus-ring aria-invalid:inset-ring-2 aria-invalid:inset-ring-attention"
              />
            </Fragment>
          ))}
        </div>
        {error ? (
          <p role="alert" className="-mt-3 text-center text-paragraph-xs text-attention">
            {error}
          </p>
        ) : null}
        {note ? (
          <p role="status" className="-mt-3 text-center text-paragraph-xs text-muted-foreground">
            {note}
          </p>
        ) : null}
        <Button type="submit" disabled={pending} className="h-11 w-full">
          {t("signIn")}
        </Button>
      </form>
      <div className="flex justify-center gap-4 text-paragraph-xs">
        <button
          type="button"
          onClick={resend}
          className="cursor-pointer text-muted-foreground underline focus-ring"
        >
          {t("newCode")}
        </button>
        <button
          type="button"
          onClick={() => {
            sessionStorage.removeItem(EMAIL_KEY);
            router.push("/sign-in");
          }}
          className="cursor-pointer text-muted-foreground underline focus-ring"
        >
          {t("otherEmail")}
        </button>
      </div>
    </>
  );
}
