import { expect, test } from "@playwright/test";

import { signedInPage } from "./helpers";

// What each person may open (plan 3.3, 4.1, 4.8 and 15.3): the menu shows
// only their views, and a link to anything else goes to their start page.

test("the menu shows only the viewer's views, and other links go to the start page", async ({ browser }) => {
  const page = await signedInPage(browser, "viewer");
  await page.goto("/se/availability");
  for (const name of ["What patients see", "Clinics", "Patient vs Muntra", "NPS"]) {
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  }
  for (const name of ["Funnel", "Users", "Tracking Framework"]) {
    await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
  }
  for (const path of ["/se/funnel", "/se/admin/users", "/no/availability", "/dk"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/se\/availability$/);
  }
});

test("a Coming soon module shows its name and that it is being built", async ({ browser }) => {
  const page = await signedInPage(browser, "viewer");
  await page.goto("/se/nps");
  await expect(page.getByText("Coming soon", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("NPS is being built.")).toBeVisible();
  await expect(page).toHaveTitle("NPS · Oral Care Digital");
});

test("an outside agency reaches Tracking Framework only", async ({ browser }) => {
  const page = await signedInPage(browser, "agency");
  await page.goto("/");
  await expect(page).toHaveURL(/\/se\/tracking-framework$/);
  await page.goto("/se/availability");
  await expect(page).toHaveURL(/\/se\/tracking-framework$/);
});

test("the market switcher shows markets without access as locked", async ({ browser }) => {
  const page = await signedInPage(browser, "viewer");
  await page.goto("/se/availability");
  await page.getByRole("button", { name: "Market" }).click();
  await expect(page.getByText("No access").first()).toBeVisible();
});

test("an unknown page answers 404 with a way back", async ({ browser }) => {
  const page = await signedInPage(browser, "viewer");
  const response = await page.goto("/se/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByText("Page not found")).toBeVisible();
});

test("/ and /{market} go to the start page", async ({ browser }) => {
  const page = await signedInPage(browser, "admin");
  await page.goto("/");
  await expect(page).toHaveURL(/\/se\/availability$/);
  await page.goto("/dk");
  await expect(page).toHaveURL(/\/dk\/availability$/);
  await expect(page.getByText("No data for Denmark yet")).toBeVisible();
});
