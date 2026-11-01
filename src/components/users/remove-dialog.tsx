"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

import type { UserActions, UserListRow } from "./types";

// "Remove {name}?" (plan 4.9): the cursor starts on Cancel, and Esc or a
// click outside closes it.
export function RemoveDialog({
  user,
  remove,
  onClose,
}: {
  user: UserListRow | null;
  remove: UserActions["remove"];
  onClose: () => void;
}) {
  const t = useTranslations("users");
  const tAll = useTranslations();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const name = user ? `${user.firstName} ${user.lastName}` : "";
  return (
    <Dialog
      open={user !== null}
      onOpenChange={(open) => {
        if (!open) {
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent showCloseButton={false} role="alertdialog" className="max-w-105 gap-0 p-6 sm:max-w-105">
        <DialogTitle className="text-paragraph-large font-semibold">{t("removeTitle", { name })}</DialogTitle>
        <DialogDescription className="mt-2 text-paragraph-small text-muted-foreground">
          {t("removeText", { name, email: user?.email ?? "" })}
        </DialogDescription>
        {error ? (
          <p role="alert" className="mt-3 text-paragraph-xs text-attention">
            {error}
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            className="bg-attention hover:bg-attention/85"
            onClick={() =>
              start(async () => {
                if (!user) return;
                const result = await remove(user.id);
                if (result.ok) onClose();
                else setError(tAll(Object.values(result.errors)[0] ?? "users.errors.gone"));
              })
            }
          >
            {t("removeConfirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
