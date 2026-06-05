import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * App-shell smoke test. Catches the class of regression where the SPA fails to
 * boot (white screen) - e.g. a broken plugin init, a bad provider, or an auth
 * passthrough bug. Runs in the authenticated `chromium` project (a real admin
 * session created by `auth.setup.ts`), so it lands on the dashboard rather than
 * the login/onboarding gate.
 */
test.describe("app shell", () => {
  test("boots and renders the dashboard chrome", async ({ page }) => {
    await page.goto("/");

    // The navbar logo renders only once the SPA has mounted - a white screen
    // (boot failure) would never show it.
    await expect(page.getByRole("heading", { name: "Checkstack" })).toBeVisible();

    // The global search box is always present in the shell.
    await expect(page.getByText(/Search/)).toBeVisible();

    // We must NOT be on the catch-all 404.
    await expect(page.locator("body")).not.toContainText("Route not found");
  });
});
