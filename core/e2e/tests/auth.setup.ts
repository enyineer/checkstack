import { test as setup, expect } from "@checkstack/test-utils-frontend/playwright";
import { ADMIN_USER, ADMIN_STORAGE_STATE } from "./support/auth";

/**
 * Authentication setup. Runs once (as the `setup` project) before the
 * authenticated specs and persists a logged-in better-auth session for them to
 * reuse via `storageState`.
 *
 * The harness resets to an empty database each run, so the app boots into the
 * first-run onboarding flow. Completing it creates the admin AND auto-signs in
 * (OnboardingPage calls `signIn.email` then redirects to `/`), so by the time we
 * land back on the dashboard the session cookie is set and can be saved. This
 * also gives us real coverage of the onboarding happy path for free.
 */
setup("authenticate (onboard first admin)", async ({ page }) => {
  await page.goto("/");

  // OnboardingCheck redirects a fresh install to /auth/onboarding.
  await page.waitForURL(/\/auth\/onboarding$/);
  await expect(
    page.getByRole("heading", { name: "Welcome to Checkstack" }),
  ).toBeVisible();

  await page.locator("#name").fill(ADMIN_USER.name);
  await page.locator("#email").fill(ADMIN_USER.email);
  await page.locator("#password").fill(ADMIN_USER.password);
  await page.locator("#confirmPassword").fill(ADMIN_USER.password);

  await page.getByRole("button", { name: "Complete Setup" }).click();

  // On success the page briefly shows a confirmation card, auto-signs in, then
  // redirects to "/". The card is transient, so assert on the durable
  // authenticated signal instead: landed on the dashboard with the user menu
  // (a logged-in-only navbar control showing the admin's name), and NOT bounced
  // back to the login/onboarding gate.
  await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });
  await expect(
    page.getByRole("button", { name: ADMIN_USER.name }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page).not.toHaveURL(/\/(login|auth\/onboarding)/);

  await page.context().storageState({ path: ADMIN_STORAGE_STATE });
});
