import { expect, test } from "@playwright/test";

import { codeFor, enterCode, newContext, requestCode, signedInPage } from "./helpers";
import { PEOPLE } from "./people";

// Signing in (plan 4.2, 11 and 15.3): the e-mail, the code, the market,
// straight in with one market, a wrong code, the wait, and the same answer for
// an address that isn't invited.

test("someone with several markets chooses one after the code", async ({ browser }) => {
  const page = await signedInPage(browser, "admin");
  await page.goto("/sign-in/market");
  for (const name of ["Sweden", "Norway", "Denmark", "Netherlands"]) {
    await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
  }
  await page.getByRole("link", { name: /Sweden/ }).click();
  await expect(page).toHaveURL(/\/se\/availability$/);
});

test("someone with one market goes straight to their start page", async ({ browser }) => {
  const page = await signedInPage(browser, "viewer");
  await page.goto("/sign-in/market");
  await expect(page).toHaveURL(/\/se\/availability$/);
});

test("a wrong code is refused, and after 3 wrong codes the address has to wait", async ({ browser }) => {
  const page = await (await newContext(browser)).newPage();
  await requestCode(page, PEOPLE.wrongCode.email);
  await codeFor(page, PEOPLE.wrongCode.email);
  // Each try waits for its answer, so the next code is never typed while the
  // form is still busy and every wrong code is counted.
  const tryCode = async (code: string) => {
    const answered = page.waitForResponse((r) => r.url().endsWith("/api/auth/sign-in/email-otp"));
    await enterCode(page, code);
    await answered;
  };
  await tryCode("00000000");
  await expect(page.getByText("That code didn't work. Check the e-mail and try again.")).toBeVisible();
  for (let i = 0; i < 2; i++) await tryCode("11111111");
  await tryCode("22222222");
  await expect(page.getByText("Too many tries. Wait a few minutes and try again.")).toBeVisible();
});

test("an address that isn't invited gets the same answer and no code", async ({ browser }) => {
  const page = await (await newContext(browser)).newPage();
  await requestCode(page, "not-invited@oralcare.se");
  await page.waitForTimeout(1_000);
  expect((await page.request.get("/api/test/inbox?address=not-invited@oralcare.se")).status()).toBe(404);
});

test("someone without any view sees that they have no access yet", async ({ browser }) => {
  const page = await signedInPage(browser, "noViews");
  await page.goto("/");
  await expect(page).toHaveURL(/\/no-access$/);
  await expect(page.getByText("You don't have access to any views")).toBeVisible();
  await expect(page.getByText("Ask an admin to give you access.")).toBeVisible();
});

test("signing out ends the session", async ({ browser }) => {
  const page = await signedInPage(browser, "viewer");
  await page.goto("/se/availability");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/se/availability");
  await expect(page).toHaveURL(/\/sign-in$/);
});
