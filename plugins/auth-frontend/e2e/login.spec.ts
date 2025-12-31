import { test, expect } from "@checkmate/test-utils-frontend/playwright";

/**
 * Sample E2E test for auth-frontend login page.
 *
 * Prerequisites:
 * - Frontend dev server running: bun run dev (in packages/frontend)
 * - Backend dev server running: bun run dev (in packages/backend)
 *
 * Run with: bun run test:e2e
 */

test.describe("Login Page", () => {
  test("should display the login page", async ({ page }) => {
    await page.goto("/login");

    // Check that the page title or main heading is visible
    await expect(page.locator("h1, h2").first()).toBeVisible();
  });

  test("should show login form elements", async ({ page }) => {
    await page.goto("/login");

    // Check for common login form elements
    // Using flexible selectors since actual implementation may vary
    const emailInput = page.locator(
      'input[type="email"], input[name="email"], input[placeholder*="email" i]'
    );
    const passwordInput = page.locator(
      'input[type="password"], input[name="password"]'
    );
    const submitButton = page.locator(
      'button[type="submit"], button:has-text("Login"), button:has-text("Sign in")'
    );

    // At least one of these should be present for a login page
    const hasLoginForm =
      (await emailInput.count()) > 0 ||
      (await passwordInput.count()) > 0 ||
      (await submitButton.count()) > 0;

    expect(hasLoginForm).toBe(true);
  });

  test("should navigate to register page from login", async ({ page }) => {
    await page.goto("/login");

    // Look for a register/sign up link
    const registerLink = page.locator(
      'a:has-text("Register"), a:has-text("Sign up"), a[href*="register"]'
    );

    if ((await registerLink.count()) > 0) {
      await registerLink.first().click();

      // Should navigate to a register page
      await expect(page).toHaveURL(/register|signup/);
    }
  });
});
