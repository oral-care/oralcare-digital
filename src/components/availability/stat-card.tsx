import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { EYEBROW } from "@/components/layout/eyebrow";
import { cn } from "@/lib/utils";

// A card with a count (plan 4.4 and 4.6): the label, the number with its
// unit, a line under it and, for Slots not online, a link. A card that needs
// attention is orange.
export function StatCard({
  label,
  value,
  unit,
  note,
  link,
  attention = false,
}: {
  label: string;
  value: string;
  unit: string;
  note: string;
  link?: { href: string; text: string };
  attention?: boolean;
}) {
  const className = cn(
    "flex flex-col rounded-xl border border-border bg-card p-5 text-foreground no-underline",
    attention && "border-status-attention-border bg-status-attention",
    link && "transition-colors hover:border-ring focus-ring",
  );
  const content = (
    <>
      <span className={EYEBROW}>{label}</span>
      <span className="mt-3 text-stat tabular-nums">
        {value} <small className="text-paragraph-regular font-medium text-muted-foreground">{unit}</small>
      </span>
      <span className="mt-1.5 text-paragraph-xs text-muted-foreground">{note}</span>
      {link ? (
        <span className="mt-auto inline-flex items-center gap-1 pt-3 text-paragraph-xs font-medium">
          {link.text} <ArrowRight aria-hidden="true" className="size-3.5" />
        </span>
      ) : null}
    </>
  );
  return link ? (
    <Link href={link.href} className={className}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

/** The cards in rows of four, two under 1100 px (plan 4.12). */
export function StatGrid({ columns = 4, children }: { columns?: 2 | 4; children: React.ReactNode }) {
  return <div className={cn("grid grid-cols-2 gap-3", columns === 4 && "wide:grid-cols-4")}>{children}</div>;
}
