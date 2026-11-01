"use client";

import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";

import { ROW } from "./table";

// A row that opens a page (plan 4.4-4.7). The whole row is clickable with the
// mouse; with the keyboard, the link in its first cell opens the same page.
export function ClickRow({
  href,
  muted = false,
  children,
}: {
  href: string;
  /** Rows that are not online are grey (plan 4.6). */
  muted?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <tr
      className={cn(ROW, "cursor-pointer hover:*:bg-oc-green-50", muted && "text-muted-foreground")}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a, button")) return;
        router.push(href);
      }}
    >
      {children}
    </tr>
  );
}
