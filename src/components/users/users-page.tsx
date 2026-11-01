"use client";

import { Pencil, Plus, Trash } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { HeaderTip } from "@/components/data-table/header-tip";
import { PageHead } from "@/components/layout/page-head";
import { Button } from "@/components/ui/button";

import { RemoveDialog } from "./remove-dialog";
import type { MarketOption, UserActions, UserListRow, ViewOption } from "./types";
import { UserForm } from "./user-form";

const CELL = "border-b border-border px-5 py-3.5 align-middle text-paragraph-small";

// Users (plan 4.9): the text and "+ Invite user", the form above the list,
// and one row per user with a pencil and a bin. Your own row has no bin, but
// the pencil stays in the same place.
export function UsersPage({
  rows,
  views,
  markets,
  actions,
}: {
  rows: UserListRow[];
  views: ViewOption[];
  markets: MarketOption[];
  actions: UserActions;
}) {
  const t = useTranslations("users");
  const router = useRouter();
  // undefined: no form; null: inviting; a row: changing that user.
  const [editing, setEditing] = useState<UserListRow | null | undefined>(undefined);
  const [removing, setRemoving] = useState<UserListRow | null>(null);
  const done = () => {
    setEditing(undefined);
    router.refresh();
  };

  return (
    <>
      <PageHead
        title={t("heading")}
        lead={t("lead")}
        action={
          <Button type="button" onClick={() => setEditing(null)}>
            <Plus aria-hidden="true" />
            {t("invite")}
          </Button>
        }
      />
      {editing !== undefined ? (
        <UserForm
          key={editing?.id ?? "invite"}
          user={editing}
          views={views}
          markets={markets}
          actions={actions}
          onDone={done}
        />
      ) : null}
      <div className="mt-4 rounded-xl border border-border bg-card">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <HeaderTip label={t("columns.user")} tip={t("tips.user")} />
              <HeaderTip label={t("columns.access")} tip={t("tips.access")} />
              <HeaderTip label={t("columns.markets")} tip={t("tips.markets")} />
              <HeaderTip label={t("columns.role")} tip={t("tips.role")} />
              <HeaderTip label={t("columns.lastSignIn")} tip={t("tips.lastSignIn")} alignRight />
              <th className="border-b border-border" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const name = `${row.firstName} ${row.lastName}`;
              return (
                <tr key={row.id}>
                  <td className={CELL}>
                    <div className="flex items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="inline-flex size-7 flex-none items-center justify-center rounded-full bg-oc-green-200 text-paragraph-nano font-semibold text-oc-green-600"
                      >
                        {row.initials}
                      </span>
                      <span>
                        <strong className="font-medium">{name}</strong>
                        <br />
                        <span className="text-muted-foreground">{row.email}</span>
                      </span>
                    </div>
                  </td>
                  <td className={CELL}>{row.accessText}</td>
                  <td className={CELL}>{row.marketsText}</td>
                  <td className={CELL}>{t(`roles.${row.role}`)}</td>
                  <td className={`${CELL} text-muted-foreground`}>{row.lastSignIn}</td>
                  <td className={`${CELL} text-right whitespace-nowrap`}>
                    <span className="inline-flex gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("edit", { name })}
                        className="text-muted-foreground"
                        onClick={() => setEditing(row)}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                      {row.isSelf ? (
                        <span aria-hidden="true" className="invisible size-8" />
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("remove", { name })}
                          className="text-muted-foreground"
                          onClick={() => setRemoving(row)}
                        >
                          <Trash aria-hidden="true" />
                        </Button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <RemoveDialog
        user={removing}
        remove={actions.remove}
        onClose={() => {
          setRemoving(null);
          router.refresh();
        }}
      />
    </>
  );
}
