import { test as setup, expect } from "@checkstack/test-utils-frontend/playwright";
import { MEMBER_USER, MEMBER_STORAGE_STATE } from "./support/auth";

/**
 * Second-actor setup. Runs as the `setup-member` project AFTER `setup-admin`
 * (the first user must already exist as the admin, so this self-registration
 * produces a plain, NON-admin member). Persists the member's better-auth session
 * to `MEMBER_STORAGE_STATE` for the permissions spec to reuse via `storageState`.
 *
 * Registration goes through the PUBLIC `/auth/register` credential flow, which a
 * fresh instance allows by default (`allowRegistration` defaults to true). On
 * success the page does a full navigation to "/", landing logged in.
 */
setup("register a non-admin member", async ({ page }) => {
  await page.goto("/auth/register");

  await expect(
    page.getByRole("heading", { name: "Create your account" }),
  ).toBeVisible({ timeout: 30_000 });

  await page.locator("#name").fill(MEMBER_USER.name);
  await page.locator("#email").fill(MEMBER_USER.email);
  await page.locator("#password").fill(MEMBER_USER.password);

  await page.getByRole("button", { name: "Create Account" }).click();

  // On success RegisterPage navigates to "/" (full reload to refresh the navbar
  // session). Assert the durable authenticated signal: the dashboard with the
  // member's user menu, and NOT bounced back to the login/onboarding gate.
  await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });
  await expect(
    page.getByRole("button", { name: MEMBER_USER.name }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page).not.toHaveURL(/\/(login|auth\/onboarding|auth\/register)/);

  await page.context().storageState({ path: MEMBER_STORAGE_STATE });
});
