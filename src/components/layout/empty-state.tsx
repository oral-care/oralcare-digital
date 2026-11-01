import type { LucideIcon } from "lucide-react";

// A page without content yet (plan 4.8 and 4.10): an icon, a title and a line.
export function EmptyState({ icon: Icon, title, text }: { icon?: LucideIcon; title: string; text: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-6 py-14 text-center">
      {Icon ? (
        <span className="mb-4 inline-flex rounded-full bg-oc-green-200 p-3 text-oc-green-600">
          <Icon aria-hidden="true" className="size-6" />
        </span>
      ) : null}
      <h2 className="mb-1.5 text-paragraph-large font-semibold">{title}</h2>
      <p className="mx-auto max-w-110 text-paragraph-small text-muted-foreground">{text}</p>
    </div>
  );
}
