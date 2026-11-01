import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { PEOPLE, type Person } from "./people";

// Signing in through the real pages, with the code from the test inbox
// (plan 15.3). Each context gets its own IP address, so the per-IP limits
// don't spill from one test into another.

let nextIp = 1;
export const freshIp = () => `198.51.100.${nextIp++}`;

export async function newContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": freshIp() } });
}

/** The latest code e-mailed to the address, waiting for it to arrive. */
export async function codeFor(page: Page, email: string, previous: string | null = null): Promise<string> {
  let code: string | null = null;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/test/inbox?address=${encodeURIComponent(email)}`);
        if (!response.ok()) return null;
        const match = /(\d{4}) (\d{4})/.exec(await response.text());
        code = match ? `${match[1]}${match[2]}` : null;
        return code !== null && code !== previous ? code : null;
      },
      { timeout: 10_000 },
    )
    .not.toBeNull();
  return code!;
}

export async function requestCode(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByPlaceholder("Work e-mail").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/sign-in\/code$/);
  await expect(page.getByText(`Code sent to ${email}`)).toBeVisible();
}

export async function enterCode(page: Page, code: string): Promise<void> {
  await page.getByLabel("Digit 1", { exact: true }).click();
  await page.keyboard.type(code);
  await page.getByRole("button", { name: "Sign in" }).click();
}

const signedIn = new Map<Person, Awaited<ReturnType<BrowserContext["storageState"]>>>();

/** A page signed in as the person. Each person signs in once; later calls reuse the session. */
export async function signedInPage(browser: Browser, person: Person): Promise<Page> {
  const saved = signedIn.get(person);
  if (saved) {
    const context = await browser.newContext({
      storageState: saved,
      extraHTTPHeaders: { "x-forwarded-for": freshIp() },
    });
    return context.newPage();
  }
  const context = await newContext(browser);
  const page = await context.newPage();
  const { email } = PEOPLE[person];
  await requestCode(page, email);
  await enterCode(page, await codeFor(page, email));
  await expect(page).not.toHaveURL(/\/sign-in\/code$/);
  signedIn.set(person, await context.storageState());
  return page;
}
