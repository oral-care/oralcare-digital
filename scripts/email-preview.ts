import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { exampleEmails } from "../src/lib/email/examples";
import { escape, LOGO_URL } from "../src/lib/email/layout";

// pnpm email:preview: every e-mail with made-up data as HTML and plain text in
// .email-preview/, which is never checked in (plan 9). Open index.html.

const dir = ".email-preview";
mkdirSync(dir, { recursive: true });

const emails = exampleEmails();
for (const [name, email] of Object.entries(emails)) {
  // The logo is served from the app's domain; the preview uses the file itself.
  writeFileSync(path.join(dir, `${name}.html`), email.html.replaceAll(LOGO_URL, "../public/logo-email.png"));
  writeFileSync(
    path.join(dir, `${name}.txt`),
    `Subject: ${email.subject}\nPreheader: ${email.preheader}\n\n${email.text}\n`,
  );
}

const rows = Object.entries(emails)
  .map(
    ([name, email]) =>
      `<li><a href="${name}.html">${escape(name)}</a> (<a href="${name}.txt">text</a>)<br><b>${escape(email.subject)}</b><br>${escape(email.preheader)}</li>`,
  )
  .join("");
writeFileSync(
  path.join(dir, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>E-mail preview</title><body style="font-family:sans-serif;max-width:720px;margin:40px auto;line-height:1.5"><h1>E-mail preview</h1><ul>${rows}</ul></body>`,
);
console.log(`Wrote ${Object.keys(emails).length} e-mails to ${dir}/index.html`);
