import { expect, test } from "@playwright/test";

import { newContext, requestCode, signedInPage } from "./helpers";

// Screenshots as a check of the spacing (plan 15.3), saved to
// test-results/screens for a person to look at. They assert nothing.

const shot = (name: string) => ({ path: `test-results/screens/${name}.png`, fullPage: true });

test("sign-in pages", async ({ browser }) => {
  const page = await (await newContext(browser)).newPage();
  await page.goto("/sign-in");
  await page.screenshot(shot("1-sign-in"));
  await requestCode(page, "e2e-viewer@oralcare.se");
  await page.screenshot(shot("2-sign-in-code"));
});

test("the frame, Users, the form and the dialog", async ({ browser }) => {
  const page = await signedInPage(browser, "admin");
  await page.goto("/sign-in/market");
  await page.screenshot(shot("3-choose-market"));
  await page.goto("/se/admin/users");
  await page.screenshot(shot("4-users"));
  await page.getByRole("button", { name: "Invite user" }).click();
  await page.screenshot(shot("5-invite-form"));
  await page.goto("/se/admin/users");
  await page
    .getByRole("button", { name: /^Remove / })
    .first()
    .click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.screenshot(shot("6-remove-dialog"));
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Market" }).click();
  await page.screenshot(shot("7-market-switcher"));
  await page.goto("/se/nps");
  await page.screenshot(shot("8-coming-soon"));
  await page.goto("/dk/availability");
  await page.screenshot(shot("9-no-data"));
});

test("the Availability pages and a filter menu", async ({ browser }) => {
  const page = await signedInPage(browser, "viewer");
  await page.goto("/se/availability");
  await page.screenshot(shot("10-what-patients-see"));
  await page.getByRole("button", { name: /Clinics/ }).click();
  await expect(page.getByRole("listbox")).toBeVisible();
  // Let the menu's opening animation finish.
  await page.waitForTimeout(300);
  await page.screenshot(shot("11-clinics-filter"));
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Period/ }).click();
  await page.getByRole("option", { name: /Custom period/ }).click();
  await expect(page.getByText("Choose a start date")).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot(shot("12-calendar"));
  await page.keyboard.press("Escape");
  await page.goto("/se/availability?v=clinic");
  await page.screenshot(shot("13-by-clinic"));
  await page.goto("/se/availability/clinics");
  await page.screenshot(shot("14-clinics"));
  await page.getByRole("link", { name: "Oral Care Epsilon" }).click();
  await expect(page.getByRole("heading", { name: "Oral Care Epsilon" })).toBeVisible();
  await page.screenshot(shot("15-clinic"));
  await page.goto("/se/availability/patient-vs-muntra");
  await page.screenshot(shot("16-patient-vs-muntra"));
});
