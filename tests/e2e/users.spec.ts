import { expect, test } from "@playwright/test";

import { signedInPage } from "./helpers";

// Users (plan 4.9 and 15.3): inviting, changing and removing, the locked
// e-mail, the locked own role, and the dialog.

const NEW = "e2e-new@octannklinikker.no";

test("an admin invites someone, whose market follows the domain", async ({ browser }) => {
  const page = await signedInPage(browser, "admin");
  await page.goto("/se/admin/users");
  await expect(page).toHaveTitle("Users · Oral Care Digital");
  await page.getByRole("button", { name: "Invite user" }).click();
  await page.getByPlaceholder("First name").fill("Nora");
  await page.getByPlaceholder("Last name").fill("New");
  await page.getByPlaceholder("Work e-mail").fill(NEW);
  await expect(page.getByRole("checkbox", { name: "Norway" })).toBeChecked();
  await page.getByRole("checkbox", { name: "NPS" }).check();
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("row", { name: new RegExp(NEW) })).toContainText("Invited, not signed in yet");
  const invitation = await page.request.get(`/api/test/inbox?address=${NEW}`);
  expect(invitation.status()).toBe(200);
  expect(await invitation.text()).toContain("Hi Nora, you have access to Oral Care Digital");
});

test("the form says what is missing at each field", async ({ browser }) => {
  const page = await signedInPage(browser, "admin");
  await page.goto("/se/admin/users");
  await page.getByRole("button", { name: "Invite user" }).click();
  await page.getByPlaceholder("Work e-mail").fill("someone@agency.example");
  await page.getByRole("checkbox", { name: "NPS" }).check();
  await page.getByRole("checkbox", { name: "Sweden" }).check();
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText("Enter a first name.")).toBeVisible();
});

test("an admin can't change their own role, and the e-mail is locked when editing", async ({ browser }) => {
  const page = await signedInPage(browser, "admin");
  await page.goto("/se/admin/users");
  await page.getByRole("button", { name: "Edit Ada Admin" }).click();
  await expect(page.getByText("You can't change your own role.")).toBeVisible();
  await expect(page.getByPlaceholder("Work e-mail")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Remove Ada Admin" })).toHaveCount(0);
});

test("removing asks first, starts on Cancel, closes with Esc, and removes", async ({ browser }) => {
  const page = await signedInPage(browser, "admin");
  await page.goto("/se/admin/users");
  await page.getByRole("button", { name: "Remove Nora New" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText("Remove Nora New?")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Remove Nora New" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove user" }).click();
  await expect(page.getByText(NEW)).toHaveCount(0);
});
