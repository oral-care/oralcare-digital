"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { EYEBROW } from "@/components/layout/eyebrow";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { Role } from "@/lib/db/schema/auth";
import { cn } from "@/lib/utils";

import type { ActionResult, MarketOption, UserActions, UserListRow, ViewOption } from "./types";

type Errors = Partial<Record<string, string>>;

/** Checkboxes with "All", which is ticked exactly when every box is (plan 4.9). */
function Checks<K extends string>({
  label,
  allLabel,
  options,
  value,
  onChange,
  error,
}: {
  label: string;
  allLabel: string;
  options: { key: K; name: string }[];
  value: K[];
  onChange: (next: K[]) => void;
  error?: string;
}) {
  const all = options.every((o) => value.includes(o.key));
  const item = (key: string, name: string, checked: boolean, toggle: () => void) => (
    <label key={key} className="inline-flex cursor-pointer items-center gap-2.5 text-paragraph-small">
      <Checkbox checked={checked} onCheckedChange={toggle} />
      {name}
    </label>
  );
  return (
    <fieldset>
      <legend className={EYEBROW}>{label}</legend>
      <div className="mt-2.5 flex flex-wrap gap-x-6 gap-y-3">
        {item("all", allLabel, all, () => onChange(all ? [] : options.map((o) => o.key)))}
        {options.map((o) =>
          item(o.key, o.name, value.includes(o.key), () =>
            onChange(value.includes(o.key) ? value.filter((v) => v !== o.key) : [...value, o.key]),
          ),
        )}
      </div>
      <FieldError message={error} />
    </fieldset>
  );
}

function FieldError({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="mt-2 text-paragraph-xs text-attention">
      {message}
    </p>
  ) : null;
}

// One form for inviting and changing a user (plan 3.4 and 4.9), opened above
// the list. The e-mail is locked when changing, since it is the account. Your
// own role is locked. The address's domain ticks its market.
export function UserForm({
  user,
  views,
  markets,
  actions,
  onDone,
}: {
  user: UserListRow | null;
  views: ViewOption[];
  markets: MarketOption[];
  actions: UserActions;
  onDone: () => void;
}) {
  const t = useTranslations("users");
  const tAll = useTranslations();
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [chosenViews, setViews] = useState(user?.views ?? []);
  const [chosenMarkets, setMarkets] = useState(user?.markets ?? []);
  const [role, setRole] = useState<Role>(user?.role ?? "viewer");
  const [errors, setErrors] = useState<Errors>({});
  const [pending, start] = useTransition();
  const ownRole = Boolean(user?.isSelf);
  const message = (field: string) => (errors[field] ? tAll(errors[field]) : undefined);

  function changeEmail(value: string) {
    setEmail(value);
    const domain = value.trim().toLowerCase().split("@")[1];
    const market = markets.find((m) => m.domain === domain);
    if (market && !chosenMarkets.includes(market.code)) setMarkets([...chosenMarkets, market.code]);
  }

  function save() {
    start(async () => {
      const input = { firstName, lastName, views: chosenViews, markets: chosenMarkets, role };
      const result: ActionResult = user
        ? await actions.update(user.id, input)
        : await actions.invite({ ...input, email });
      if (result.ok) onDone();
      else setErrors(result.errors);
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      noValidate
      className="grid gap-4 rounded-xl border border-border bg-card p-6"
    >
      <h2 className="text-paragraph-large font-semibold">
        {user ? t("editTitle", { name: `${user.firstName} ${user.lastName}` }) : t("inviteTitle")}
      </h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-50 flex-1 flex-col gap-1.5">
          <span className={EYEBROW}>{t("firstName")}</span>
          <Input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder={t("firstName")}
            autoComplete="off"
            autoFocus
            aria-invalid={errors.firstName ? true : undefined}
          />
          <FieldError message={message("firstName")} />
        </label>
        <label className="flex min-w-50 flex-1 flex-col gap-1.5">
          <span className={EYEBROW}>{t("lastName")}</span>
          <Input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder={t("lastName")}
            autoComplete="off"
            aria-invalid={errors.lastName ? true : undefined}
          />
          <FieldError message={message("lastName")} />
        </label>
      </div>
      <label className="flex min-w-65 flex-col gap-1.5">
        <span className={EYEBROW}>{t("email")}</span>
        <Input
          type="email"
          value={email}
          onChange={(e) => changeEmail(e.target.value)}
          placeholder={t("emailPlaceholder")}
          disabled={Boolean(user)}
          aria-invalid={errors.email ? true : undefined}
          className="disabled:text-muted-foreground"
        />
        <FieldError message={message("email")} />
      </label>
      <Checks
        label={t("access")}
        allLabel={t("allViews")}
        options={views}
        value={chosenViews}
        onChange={setViews}
        error={message("views")}
      />
      <Checks
        label={t("markets")}
        allLabel={t("allMarkets")}
        options={markets.map((m) => ({ key: m.code, name: m.name }))}
        value={chosenMarkets}
        onChange={setMarkets}
        error={message("markets")}
      />
      <div>
        <span className={EYEBROW}>{t("role")}</span>
        <div role="group" aria-label={t("role")} className="mt-1.5 flex flex-wrap gap-2">
          {(["viewer", "admin"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={role === value}
              disabled={ownRole}
              onClick={() => setRole(value)}
              className={cn(
                "inline-flex h-10 cursor-pointer items-center rounded-full border border-border bg-card px-3.5 text-paragraph-small focus-ring disabled:cursor-not-allowed disabled:opacity-50",
                "aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground",
              )}
            >
              {t(`roles.${value}`)}
            </button>
          ))}
        </div>
        {ownRole ? <p className="mt-2 text-paragraph-xs text-muted-foreground">{t("ownRole")}</p> : null}
        <FieldError message={message("role")} />
      </div>
      <FieldError message={message("form")} />
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {user ? t("save") : t("send")}
        </Button>
      </div>
    </form>
  );
}
