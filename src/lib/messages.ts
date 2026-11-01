import { IntlMessageFormat } from "intl-messageformat";

import messages from "../../messages/en.json";

// The texts in messages/en.json, formatted with ICU MessageFormat like the
// app's (plan 9). Pure module: no Next.js and no React, so jobs can use it.

export type MessageValues = Record<string, string | number>;

const formats = new Map<string, IntlMessageFormat>();

export function t(key: string, values: MessageValues = {}): string {
  let format = formats.get(key);
  if (!format) {
    const message = key
      .split(".")
      .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages);
    if (typeof message !== "string") throw new Error(`Message ${key} is missing in messages/en.json`);
    format = new IntlMessageFormat(message, "en");
    formats.set(key, format);
  }
  return String(format.format(values));
}
