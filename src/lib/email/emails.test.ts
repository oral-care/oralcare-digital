import { describe, expect, it } from "vitest";

import { alertLine } from "@/lib/alerts/lines";
import { GUARD_ALERTS, MEASUREMENT_ALERTS } from "@/lib/alerts/types";

import { exampleAlerts, exampleEmails } from "./examples";
import { APP_URL, LOGO_URL } from "./layout";

// The e-mails with made-up data (plan 9). The text versions are snapshots, so
// a change in wording shows up in review; the HTML is checked for what every
// e-mail must have.

const emails = exampleEmails();
const EM_DASH = String.fromCharCode(0x2014);

describe("e-mails", () => {
  it.each(Object.entries(emails))("%s reads as before", (_name, email) => {
    expect({ subject: email.subject, preheader: email.preheader, text: email.text }).toMatchSnapshot();
  });

  it.each(Object.entries(emails))("%s has the preheader, the logo, the footer and no gaps", (name, email) => {
    expect(email.html).toContain(email.preheader.replaceAll("'", "&#39;").replaceAll('"', "&quot;"));
    expect(email.html).toContain(LOGO_URL);
    expect(email.html).toContain("mailto:digital@oralcaregroup.com");
    for (const text of [email.html, email.text, email.subject]) {
      // Unfilled placeholders, broken numbers and em dashes.
      expect(text).not.toMatch(/NaN|\{|\}/);
      expect(text).not.toContain(EM_DASH);
    }
    // The sign-in code has no button (plan 9).
    if (name.startsWith("1-")) expect(email.html).not.toContain(`<a href="${APP_URL}"`);
    else expect(email.html).toContain(`<a href="${APP_URL}"`);
  });

  it("escapes what comes from the sources", () => {
    const [alert] = exampleAlerts(["treatment_withdrawn"]);
    const line = alertLine({ ...alert!, payload: { treatment: "<b>Akut</b> & co" } });
    expect(line.headline).toBe("<b>Akut</b> & co was removed from oralcare.se");
    const html = exampleEmails()["3-alert-one"]!.html;
    expect(html).not.toContain("<b>");
  });

  it("gives every alert type a headline and a fact line", () => {
    for (const alert of exampleAlerts([...MEASUREMENT_ALERTS, ...GUARD_ALERTS])) {
      const line = alertLine(alert);
      expect(line.headline.length, alert.type).toBeGreaterThan(10);
      expect(line.fact.length, alert.type).toBeGreaterThan(5);
    }
  });

  it("says how many more alerts there are in the subject, in the singular for one", () => {
    expect(emails["3-alert-three"]!.subject).toBe(
      "Akut undersökning is not online at Example Clinic Norr, and 2 more alerts",
    );
    expect(emails["3-alert-one"]!.subject).toBe("Akut undersökning is not online at Example Clinic Norr");
  });
});
