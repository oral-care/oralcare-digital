import { cn } from "@/lib/utils";

// A part of a page (plan 4.4): a heading with a line under it, something on
// the right such as By treatment and By clinic, and the content.
export function Section({
  title,
  sub,
  action,
  children,
}: {
  title?: string;
  sub?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      {title ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-paragraph-large font-semibold">{title}</h2>
            {sub ? <p className="mt-0.5 text-paragraph-small text-muted-foreground">{sub}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** The white box around a table, a chart or a text. */
export function Panel({ padded = false, children }: { padded?: boolean; children: React.ReactNode }) {
  return <div className={cn("rounded-xl border border-border bg-card", padded && "p-6")}>{children}</div>;
}
