"use client";

import { useRouter } from "next/navigation";

// One clinic's rows in Patient vs Muntra (plan 4.7): hovering highlights the
// whole clinic, a click anywhere opens it, and a line runs only between
// clinics. With the keyboard, the clinic's name is the link.
export function HiddenGroupBody({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <tbody
      className="cursor-pointer border-t border-border first-of-type:border-t-0 hover:*:*:bg-oc-green-50"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a, button")) return;
        router.push(href);
      }}
    >
      {children}
    </tbody>
  );
}
