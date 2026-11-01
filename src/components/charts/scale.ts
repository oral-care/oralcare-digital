// The chart's axes (plan 4.4): four even steps on the y axis with a round step
// and room above the highest value, and about seven dates on the x axis,
// counted back from the last day so today always has a label. Pure module.

/** The y axis' ticks from 0 to the top, five values with four even steps. The top is at least 10. */
export function yTicks(values: (number | null)[]): number[] {
  const max = Math.max(10, ...values.filter((v): v is number => v !== null));
  const raw = (max * 1.1) / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
  return [0, 1, 2, 3, 4].map((k) => step * k);
}

/** The indexes of the days that get a date label, about seven, always including the last. */
export function xTickIndexes(count: number, labels = 7): number[] {
  const every = Math.max(1, Math.ceil(count / labels));
  return Array.from({ length: count }, (_, i) => i).filter((i) => (count - 1 - i) % every === 0);
}
