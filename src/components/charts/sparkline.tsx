// The small chart in a table row (plan 4.4): free slots each day in the
// period as one line, scaled to its own highest value. Days without a value
// are left out. Nothing with fewer than two values.
export function Sparkline({ values }: { values: (number | null)[] }) {
  const points = values.flatMap((v, i) => (v === null ? [] : [{ i, v }]));
  if (points.length < 2) return null;
  const max = Math.max(1, ...points.map((p) => p.v));
  const last = Math.max(1, values.length - 1);
  const d = points
    .map(
      (p, k) =>
        `${k === 0 ? "M" : "L"}${((p.i / last) * 110 + 1).toFixed(1)} ${(26 - (p.v / max) * 22).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg viewBox="0 0 112 28" aria-hidden="true" className="block h-7 w-28">
      <path d={d} fill="none" strokeWidth={1.5} strokeLinejoin="round" className="stroke-foreground" />
    </svg>
  );
}
