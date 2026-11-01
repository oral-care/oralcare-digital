// A page's heading and lead (plan 4), with room for a button on the right.
export function PageHead({
  title,
  lead,
  action,
}: {
  title: string;
  lead?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-h3">{title}</h1>
        {lead ? <p className="mt-2 max-w-160 text-paragraph-small text-muted-foreground">{lead}</p> : null}
      </div>
      {action}
    </div>
  );
}
