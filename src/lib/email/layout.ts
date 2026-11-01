import { t } from "@/lib/messages";

import { emailColours as c, emailFont } from "./tokens";

// The building blocks of every e-mail, as in the e-mail prototype (plan 9):
// tables and inline styles so Outlook, Gmail and Apple Mail show the same
// thing, the logo with "Digital", a white card on grey, black round buttons,
// small capital labels, and orange only for what needs action. Each block has
// an HTML and a plain-text form. Pure module.

/** Where every button leads (plan 9). */
export const APP_URL = "https://digital.oralcaregroup.com";
export const LOGO_URL = `${APP_URL}/logo-email.png`;
export const SENDER_ADDRESS = "digital@oralcaregroup.com";

export type Block = { html: string; text: string };
export type Email = { subject: string; preheader: string; html: string; text: string };

export function escape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const LABEL = `font-size:11px;line-height:16px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${c.muted};`;
const CELL = `padding:14px 0;border-bottom:1px solid ${c.border};`;
const LIST_CELL = `padding:12px 0;border-bottom:1px solid ${c.border};font-size:14px;line-height:20px;`;
const DOT = `<td width="20" style="${CELL}vertical-align:top;font-size:14px;line-height:20px;color:${c.attention};">●</td>`;
const table = (style: string, rows: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${style}">${rows}</table>`;

/** A small capital label above a heading or a list. */
export function label(text: string, marginTop = 0): Block {
  return {
    html: `<p style="margin:${marginTop}px 0 0;${LABEL}">${escape(text)}</p>`,
    text: text.toUpperCase(),
  };
}

export function heading(text: string, marginTop = 0): Block {
  return {
    html: `<h1 style="margin:${marginTop}px 0 0;font-size:22px;line-height:28px;font-weight:600;color:${c.text};">${escape(text)}</h1>`,
    text,
  };
}

export function paragraph(text: string, options: { muted?: boolean; marginTop?: number } = {}): Block {
  const size = options.muted ? "font-size:13px;line-height:20px" : "font-size:15px;line-height:24px";
  const colour = options.muted ? c.muted : c.body;
  return {
    html: `<p style="margin:${options.marginTop ?? 12}px 0 0;${size};color:${colour};">${escape(text)}</p>`,
    text,
  };
}

export function button(text: string, href: string = APP_URL): Block {
  return {
    html: `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:32px;"><tr><td style="background:${c.button};border-radius:999px;"><a href="${escape(href)}" style="display:inline-block;padding:13px 24px;font-size:14px;line-height:18px;font-weight:500;color:${c.buttonText};text-decoration:none;">${escape(text)}</a></td></tr></table>`,
    text: `${text}: ${href}`,
  };
}

/** The sign-in code, in two groups of four digits. */
export function code(digits: string): Block {
  const grouped = `${digits.slice(0, 4)} ${digits.slice(4)}`;
  return {
    html: table(
      "margin-top:28px;",
      `<tr><td align="center" style="background:${c.panel};border-radius:12px;padding:24px 16px;font-size:34px;line-height:40px;font-weight:600;letter-spacing:8px;color:${c.text};font-variant-numeric:tabular-nums;">${escape(grouped).replace(" ", "&nbsp;")}</td></tr>`,
    ),
    text: grouped,
  };
}

/** Rows with a small capital label and a value, as in the invitation. */
export function facts(rows: { label: string; value: string }[]): Block {
  return {
    html: table(
      `margin-top:28px;border-top:1px solid ${c.border};`,
      rows
        .map(
          (row, i) =>
            `<tr><td style="${CELL}${LABEL}${i === 0 ? "width:120px;" : ""}">${escape(row.label)}</td><td style="${CELL}font-size:14px;line-height:20px;color:${c.text};">${escape(row.value)}</td></tr>`,
        )
        .join(""),
    ),
    text: rows.map((row) => `${row.label}: ${row.value}`).join("\n"),
  };
}

/** One row per alert: an orange dot, the headline in bold and the fact line under it. */
export function alertRows(lines: { headline: string; fact: string }[], marginTop = 28): Block {
  return {
    html: table(
      `margin-top:${marginTop}px;border-top:1px solid ${c.border};`,
      lines
        .map(
          (line) =>
            `<tr>${DOT}<td style="${CELL}vertical-align:top;"><div style="font-size:14px;line-height:20px;font-weight:600;color:${c.text};">${escape(line.headline)}</div><div style="margin-top:2px;font-size:14px;line-height:20px;color:${c.body};">${escape(line.fact)}</div></td></tr>`,
        )
        .join(""),
    ),
    text: lines.map((line) => `* ${line.headline}\n  ${line.fact}`).join("\n"),
  };
}

export type ListRow = { label: string; value: string; muted?: boolean; attention?: boolean };

/** A list of labels with a value on the right. Rows that need action are dark orange. */
export function list(rows: ListRow[]): Block {
  return {
    html: table(
      `margin-top:8px;border-top:1px solid ${c.border};`,
      rows
        .map((row) => {
          const label = row.attention ? c.attentionText : c.text;
          const value = row.attention ? c.attentionText : row.muted ? c.muted : c.text;
          return `<tr><td style="${LIST_CELL}color:${label};">${escape(row.label)}</td><td align="right" style="${LIST_CELL}color:${value};">${escape(row.value)}</td></tr>`;
        })
        .join(""),
    ),
    text: rows.map((row) => `${row.label}: ${row.value}`).join("\n"),
  };
}

/** Three key numbers in a row, like the cards in the app. */
export function stats(cards: { label: string; value: string; suffix?: string }[]): Block {
  const cell = (card: (typeof cards)[number]) =>
    `<td width="33%" style="padding:16px;background:${c.panel};border-radius:12px;vertical-align:top;"><div style="${LABEL}">${escape(card.label)}</div><div style="margin-top:8px;font-size:24px;line-height:28px;font-weight:600;color:${c.text};">${escape(card.value)}${card.suffix ? ` <span style="font-size:14px;font-weight:400;color:${c.muted};">${escape(card.suffix)}</span>` : ""}</div></td>`;
  const gap = `<td width="12" style="font-size:0;line-height:0;">&nbsp;</td>`;
  return {
    html: table("margin-top:28px;", `<tr>${cards.map(cell).join(gap)}</tr>`),
    text: cards
      .map((card) => `${card.label}: ${card.value}${card.suffix ? ` ${card.suffix}` : ""}`)
      .join("\n"),
  };
}

/** The whole e-mail: preheader, logo, the card with the blocks, and the footer with why. */
export function render(email: { subject: string; preheader: string; blocks: Block[]; why: string }): Email {
  const body = email.blocks.map((b) => b.html).join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escape(email.subject)}</title></head><body style="margin:0;padding:0;background:${c.page};">${table(
    `background:${c.page};`,
    `<tr><td align="center" style="padding:40px 16px;"><div style="display:none;max-height:0;overflow:hidden;">${escape(email.preheader)}</div><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;"><tr><td style="padding:0 8px 24px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="vertical-align:middle;"><img src="${LOGO_URL}" width="113" height="19" alt="${escape(t("email.logoAlt"))}" style="display:block;border:0;"></td><td style="vertical-align:middle;padding:5px 0 0 10px;"><div style="width:1px;height:14px;background:${c.border};"></div></td><td style="vertical-align:middle;padding:3px 0 0 10px;font-family:${emailFont};font-size:14px;line-height:14px;color:${c.muted};">${escape(t("email.product"))}</td></tr></table></td></tr><tr><td style="background:${c.card};border:1px solid ${c.border};border-radius:12px;padding:40px;font-family:${emailFont};">${body}</td></tr><tr><td style="padding:24px 8px 0;font-family:${emailFont};font-size:12px;line-height:18px;color:${c.muted};">${escape(t("email.footer"))} · <a href="mailto:${SENDER_ADDRESS}" style="color:${c.muted};">${SENDER_ADDRESS}</a><br>${escape(email.why)}</td></tr></table></td></tr>`,
  )}</body></html>`;
  const text = [
    email.blocks.map((b) => b.text).join("\n\n"),
    "--",
    `${t("email.footer")} · ${SENDER_ADDRESS}`,
    email.why,
  ].join("\n\n");
  return { subject: email.subject, preheader: email.preheader, html, text };
}
