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
