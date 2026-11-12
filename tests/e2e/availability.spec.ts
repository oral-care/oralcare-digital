import { expect, test, type Page } from "@playwright/test";

import { addDays, dayLabel, shortDate, STOCKHOLM, zonedDay } from "../../src/lib/time";
import { signedInPage } from "./helpers";

// The Availability pages (plan 4.4-4.7 and 15.3) against the made-up data in
// tests/support/availability-seed.ts: the cards, Month ahead, the chart, the
// tables, sorting, the filters with the calendar, the explanations on hover,
// a clinic's page and Patient vs Muntra.

const today = zonedDay(new Date(), STOCKHOLM);

/** A day in the calendar, by its name: "Thursday, October 22nd, 2026". */
function calendarDay(page: Page, day: string) {
  const date = new Date(`${day}T12:00:00Z`);
  const n = date.getUTCDate();
  const suffix =
    n % 10 === 1 && n !== 11
      ? "st"
      : n % 10 === 2 && n !== 12
        ? "nd"
        : n % 10 === 3 && n !== 13
          ? "rd"
          : "th";
  const month = date.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  return page.getByRole("button", { name: new RegExp(`${month} ${n}${suffix}, ${date.getUTCFullYear()}`) });
}

/** Every made-up clinic except Oral Care Eta, which couldn't be measured today. */
const MEASURED = "1,2,3,4,5,6";

/** The card with this label, as the text of the whole card. */
const card = (page: Page, label: string) =>
  page.locator("span", { hasText: new RegExp(`^${label}$`) }).locator("..");

test("the cards count every clinic once per row, and Month ahead sums the next 30 days", async ({
  browser,
}) => {
  const page = await signedInPage(browser, "viewer");
  await page.goto("/se/availability");
  await expect(page).toHaveTitle("What patients see · Oral Care Digital");
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(page.getByText("7 clinics, next 14 days")).toBeVisible();
  const expected: [string, string][] = [
    ["Good availability", "2 clinics"],
    ["Mixed availability", "1 clinic"],
    ["Low availability", "1 clinic"],
    ["Slots not online", "3 clinics"],
    ["Short waiting time", "2 clinics"],
    // Gamma: Undersökning's first slot in 8 days is long, Akut's tomorrow is short (plan 5.2).
    ["Mixed waiting time", "2 clinics"],
    // Delta: nothing online, but a first slot in 20 days, so Long and not Not online (plan 5.2).
    ["Long waiting time", "1 clinic"],
    ["Not online", "1 clinic"],
  ];
  for (const [label, count] of expected) await expect(card(page, label), label).toContainText(count);
  // Oral Care Eta couldn't be measured today: in no card, and Month ahead isn't shown (plan 5.7).
  await expect(page.getByText("1 clinic could not be measured.")).toBeVisible();
  await expect(
    page.getByText("Month ahead can't be shown: 1 clinic could not be measured in the latest measurement."),
  ).toBeVisible();
  await page.goto(`/se/availability?c=${MEASURED}`);
  await expect(
    page.getByText("In the next 30 days there are 336 free online slots at 4 clinics in 3 regions."),
  ).toBeVisible();
  await expect(page.getByText("The clinic with the most is Oral Care Alfa")).toBeVisible();

  await page
    .getByRole("link", { name: /Patient vs Muntra/ })
    .filter({ hasText: "Slots not online" })
    .click();
  // The link keeps the clinic filter (plan 4.1).
  await expect(page).toHaveURL(new RegExp(`/se/availability/patient-vs-muntra\\?c=${MEASURED}$`));
});

test("the chart's legend hides a line, and the address keeps it", async ({ browser }) => {
  const page = await signedInPage(browser, "viewer");
  await page.goto("/se/availability");
  const akut = page.getByRole("button", { name: "Akut", exact: true });
  await expect(akut).toHaveAttribute("aria-pressed", "true");
  await akut.click();
  await expect(page).toHaveURL(/hide=\d+/);
  await expect(akut).toHaveAttribute("aria-pressed", "false");
});

test("By treatment sums the clinics, and a row shows the treatment per clinic", async ({ browser }) => {
  const page = await signedInPage(browser, "viewer");
  await page.goto(`/se/availability?c=${MEASURED}`);
  const row = page.getByRole("row", { name: /^Undersökning/ });
  await expect(row).toContainText("78");
  await expect(row).toContainText("4 of 6 clinics");
  // The median of 0, 0, 1 and 8 days is half a day, rounded up (plan 5.5).
  await expect(row).toContainText("1 day");
  await row.getByRole("link", { name: "Undersökning" }).click();
  await expect(page).toHaveURL(/t=\d+&v=clinic/);
  await expect(page.getByRole("columnheader", { name: /First free slot/ })).toBeVisible();
  // Weakest first: Gamma has Low availability.
  await expect(page.getByRole("row").nth(1)).toContainText("Oral Care Gamma");
});

test("By clinic puts the weakest first, and a click opens the clinic", async ({ browser }) => {
  const page = await signedInPage(browser, "viewer");
  await page.goto("/se/availability?v=clinic");
  const rows = page.getByRole("row");
  await expect(rows.nth(1)).toContainText("Oral Care Gamma");
  await expect(rows.nth(1)).toContainText("Low");
  await expect(rows.nth(2)).toContainText("Oral Care Beta");
  await expect(rows.nth(2)).toContainText("Mixed");
  await rows.nth(1).getByRole("cell").nth(1).click();
  await expect(page).toHaveURL(/\/se\/availability\/clinics\/\d+$/);
  await expect(page.getByRole("heading", { name: "Oral Care Gamma" })).toBeVisible();
});

test("a region chooses its clinics, and a filter without clinics says so", async ({ browser }) => {
  const page = await signedInPage(browser, "viewer");
  await page.goto("/se/availability");
  await page.getByRole("button", { name: /Regions/ }).click();
  await page.getByRole("option", { name: /Norr/ }).click();
  await expect(page).toHaveURL(/c=\d+,\d+/);
  await page.keyboard.press("Escape");
  await expect(page.getByText("2 clinics, next 14 days")).toBeVisible();
  await expect(page.getByRole("button", { name: /Clinics/ })).toContainText("2 clinics");

  await page.goto("/se/availability?t=999999");
  await expect(page.getByText("Nothing matches these filters")).toBeVisible();
  await page.goto("/se/availability?c=999999");
  await expect(page.getByText("Nothing matches these filters")).toBeVisible();
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/se\/availability$/);
});

test("a custom period from the calendar shows that day's values", async ({ browser }) => {
  const page = await signedInPage(browser, "viewer");
  await page.goto("/se/availability");
  await page.getByRole("button", { name: /Period/ }).click();
  await page.getByRole("option", { name: /Custom period/ }).click();
  await expect(page.getByText("Choose a start date")).toBeVisible();
  const apply = page.getByRole("button", { name: "Apply" });
  await expect(apply).toBeDisabled();
  const from = addDays(today, -10);
  const to = addDays(today, -3);
  await calendarDay(page, from).click();
  await expect(page.getByText("Choose an end date")).toBeVisible();
  await calendarDay(page, to).click();
  await apply.click();
  await expect(page).toHaveURL(new RegExp(`p=custom&from=${from}&to=${to}`));
  await expect(page.getByRole("heading", { name: dayLabel(to) })).toBeVisible();
});

test("a column's explanation shows on hover", async ({ browser }) => {
  const page = await signedInPage(browser, "viewer");
  await page.goto("/se/availability");
  await page.getByRole("columnheader", { name: /Online at/ }).hover();
  await expect(
    page.getByText("Clinics with slots patients can book on oralcare.se, out of all clinics in the filter."),
  ).toBeVisible();
});

test("Clinics sorts the weakest first, and the same column again reverses it", async ({ browser }) => {
  const page = await signedInPage(browser, "viewer");
  await page.goto("/se/availability/clinics");
  const rows = page.getByRole("row");
  await expect(rows.nth(1)).toContainText("Oral Care Alfa");
  await page.getByRole("link", { name: "Slots not online" }).click();
  await expect(page).toHaveURL(/sort=notOnline$/);
  await expect(rows.nth(1)).toContainText("Oral Care Delta");
  await expect(rows.nth(1)).toContainText("9");
  await page.getByRole("link", { name: "Slots not online" }).click();
  await expect(page).toHaveURL(/sort=-notOnline$/);
  await expect(rows.nth(6)).toContainText("Oral Care Delta");
  await page.getByRole("link", { name: "Availability" }).click();
  await expect(rows.nth(1)).toContainText("Oral Care Gamma");
});

test("a clinic's page shows every treatment on oralcare.se", async ({ browser }) => {
  const page = await signedInPage(browser, "viewer");
  await page.goto("/se/availability/clinics");
  await page.getByRole("link", { name: "Oral Care Epsilon" }).click();
  await expect(page.getByRole("heading", { name: "Oral Care Epsilon" })).toBeVisible();
  await expect(page).toHaveTitle("Oral Care Epsilon · Oral Care Digital");
  await expect(page.getByText("Good availability", { exact: true })).toBeVisible();
  await expect(page.getByText("Short waiting time", { exact: true })).toBeVisible();
  await expect(page.getByText("Epsilonby · Region Syd")).toBeVisible();
  await expect(card(page, "On oralcare.se")).toContainText("1 of 4 treatments");
  await expect(card(page, "Slots not online")).toContainText("7 slots");
  const checkup = page.getByRole("row", { name: /^Undersökning/ });
  for (const text of ["Bookable", "Activated", "19", "7", "Today", "Good", "Short"]) {
    await expect(checkup, text).toContainText(text);
  }
  await expect(page.getByRole("row", { name: /^Tandhygienist/ })).toContainText("No slots in Muntra");
  await expect(page.getByRole("row", { name: /^Akut/ })).toContainText("Not activated");
  await page.getByRole("link", { name: "Clinics", exact: true }).first().click();
  await expect(page).toHaveURL(/\/se\/availability\/clinics$/);
});

test("a clinic that doesn't exist in the market is 404", async ({ browser }) => {
  const page = await signedInPage(browser, "viewer");
  const response = await page.goto("/se/availability/clinics/999999");
  expect(response?.status()).toBe(404);
});

test("Patient vs Muntra groups the clinics, with the day the difference started", async ({ browser }) => {
  const page = await signedInPage(browser, "viewer");
  await page.goto("/se/availability/patient-vs-muntra");
  const delta = page.getByRole("row", { name: /^Oral Care Delta/ });
  await expect(delta).toContainText("Akut");
  await expect(delta).toContainText("Not online");
  await expect(delta).toContainText(dayLabel(addDays(today, -20)));
  const epsilon = page.getByRole("row", { name: /^Oral Care Epsilon/ });
  await expect(epsilon).toContainText("12");
  await expect(epsilon).toContainText("19");
  await expect(epsilon).toContainText(dayLabel(addDays(today, -5)));
  // A difference found first in the latest measurement started today.
  const beta = page.getByRole("row", { name: /^Oral Care Beta/ });
  await expect(beta).toContainText("Tandhygienist");
  await expect(beta).toContainText("14");
  await expect(beta).toContainText(dayLabel(today));
  await epsilon.getByRole("cell").nth(1).click();
  await expect(page.getByRole("heading", { name: "Oral Care Epsilon" })).toBeVisible();

  await page.goto("/se/availability/patient-vs-muntra?c=1");
  await expect(page.getByText("Nothing hidden")).toBeVisible();
});

test("the menu keeps the period but not the clinics", async ({ browser }) => {
  const page = await signedInPage(browser, "viewer");
  await page.goto("/se/availability?c=1&p=7");
  await page.getByRole("link", { name: "Clinics", exact: true }).click();
  await expect(page).toHaveURL(/\/se\/availability\/clinics\?p=7$/);
});

test("a clinic that couldn't be measured shows n/a, never 0 or Not online", async ({ browser }) => {
  const page = await signedInPage(browser, "viewer");
  await page.goto("/se/availability");
  await expect(page.getByRole("row", { name: /^Undersökning/ })).toContainText("n/a");

  await page.goto("/se/availability/clinics");
  const eta = page.getByRole("row", { name: /^Oral Care Eta/ });
  await expect(eta).toContainText("n/a");
  await expect(eta).not.toContainText("Not online");

  await eta.getByRole("link", { name: "Oral Care Eta" }).click();
  await expect(page.getByRole("heading", { name: "Oral Care Eta" })).toBeVisible();
  await expect(card(page, "On oralcare.se")).toContainText("n/a");
  await expect(card(page, "Slots not online")).toContainText("n/a");
  await expect(page.getByRole("row", { name: /^Undersökning/ })).toContainText("n/a");
  await expect(page.locator("h1").locator("..")).not.toContainText("Not online");
});

test("Akut is short when the first slot is tomorrow", async ({ browser }) => {
  const page = await signedInPage(browser, "viewer");
  await page.goto("/se/availability/clinics/3");
  await expect(page.getByRole("heading", { name: "Oral Care Gamma" })).toBeVisible();
  const akut = page.getByRole("row", { name: /^Akut/ });
  await expect(akut).toContainText("1 day");
  await expect(akut).toContainText("Short");
});

test("a first slot after 14 days shows its date instead of Not online", async ({ browser }) => {
  const page = await signedInPage(browser, "viewer");
  const firstSlot = `First slot ${shortDate(addDays(today, 20))}`;
  await page.goto("/se/availability/clinics");
  const delta = page.getByRole("row", { name: /^Oral Care Delta/ });
  await expect(delta).toContainText("0 of 4");
  await expect(delta).toContainText(firstSlot);
  await expect(delta).toContainText("Long");
  await expect(page.getByRole("row", { name: /^Oral Care Zeta/ })).toContainText("Not online");

  await delta.getByRole("cell").nth(1).click();
  await expect(page.getByRole("heading", { name: "Oral Care Delta" })).toBeVisible();
  const heading = page.locator("h1").locator("..");
  await expect(heading).toContainText(firstSlot);
  await expect(heading).toContainText("Long waiting time");
  await expect(heading).not.toContainText("Not online");
  const checkup = page.getByRole("row", { name: /^Undersökning/ });
  await expect(checkup).toContainText(firstSlot);
  await expect(checkup).toContainText("20 days");
  await expect(page.getByRole("row", { name: /^Akut/ })).toContainText("Not online");

  // No slot as far ahead as patients can book: the days oralcare.se was searched (plan 5.4).
  await page.goto(`/se/availability?c=${MEASURED}`);
  await page.getByRole("link", { name: "Tandhygienist" }).click();
  await expect(page.getByRole("row", { name: /^Oral Care Epsilon/ })).toContainText("None in 90 days");
});
