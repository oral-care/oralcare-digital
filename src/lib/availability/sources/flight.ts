// Reads the data Next.js embeds in a page (the React Server Components flight
// payload in self.__next_f.push). oralcare.se has no API for its booking menu or
// clinic list, so the registry is read from here (plan 6.2). Pure module.

export type FlightLines = Map<string, unknown>;

const PUSH = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
const LINE = /^([0-9a-f]+):(.*)$/;

/** Parses the flight lines whose payload is JSON. Other lines are skipped. */
export function parseFlight(html: string): FlightLines {
  let text = "";
  for (const match of html.matchAll(PUSH)) {
    text += JSON.parse(match[1] ?? '""') as string;
  }
  const lines: FlightLines = new Map();
  for (const line of text.split("\n")) {
    const match = LINE.exec(line);
    if (!match) continue;
    const [, id, body] = match;
    if (!id || !body || (body[0] !== "[" && body[0] !== "{")) continue;
    try {
      lines.set(id, JSON.parse(body));
    } catch {
      // A line that isn't JSON (text, module references) carries nothing we read.
    }
  }
  return lines;
}

/** Every object anywhere in the payload for which the test is true. */
export function findObjects(lines: FlightLines, test: (value: Record<string, unknown>) => boolean) {
  const found: Record<string, unknown>[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value !== null && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (test(record)) found.push(record);
      Object.values(record).forEach(walk);
    }
  };
  lines.forEach(walk);
  return found;
}

/**
 * Follows a flight reference such as "$72:props:children:1:props:options:5".
 * A React element is the tuple ["$", type, key, props], so "props" on a tuple
 * means its fourth item. Returns undefined when any step is missing.
 */
export function resolveReference(lines: FlightLines, reference: unknown): unknown {
  if (typeof reference !== "string" || !reference.startsWith("$")) return undefined;
  const [id, ...path] = reference.slice(1).split(":");
  if (!id) return undefined;
  let current: unknown = lines.get(id);
  for (const step of path) {
    if (Array.isArray(current)) {
      current = step === "props" && current[0] === "$" ? current[3] : current[Number(step)];
    } else if (current !== null && typeof current === "object") {
      current = (current as Record<string, unknown>)[step];
    } else {
      return undefined;
    }
  }
  return current;
}
