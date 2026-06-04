import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Auth: profile, password, and strategy management.
 *
 * The browser is already authenticated as the onboarded admin (see
 * `auth.setup.ts`), so navigating to the auth routes renders the in-app pages
 * rather than the login gate. The admin's identity is fixed by the onboarding
 * setup: name "E2E Admin", email "e2e-admin@checkstack.local".
 *
 * Runs serially against one shared, fresh DB. The logout test MUST run last
 * because it ends the session for the remainder of the file.
 */
test.describe.configure({ mode: "serial" });

// Mirrors ADMIN_USER from tests/support/auth.ts (not imported - that file is a
// shared, off-limits helper). Kept in sync by the onboarding setup project.
const ADMIN_NAME = "E2E Admin";
const ADMIN_EMAIL = "e2e-admin@checkstack.local";

test.describe("auth profile, password & strategies", () => {
  test("profile page renders the admin's name and email", async ({ page }) => {
    await page.goto("/auth/profile");

    await expect(
      page.getByRole("heading", { name: "Profile" }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Manage your account settings")).toBeVisible();

    // The form is seeded from the current user's profile query.
    await expect(page.getByLabel("Name")).toHaveValue(ADMIN_NAME);
    await expect(page.getByLabel("Email")).toHaveValue(ADMIN_EMAIL);

    // The credential admin can reach the change-password flow from here.
    await expect(
      page.getByRole("link", { name: "Change Password" }),
    ).toBeVisible();
  });

  test("change-password form renders its fields", async ({ page }) => {
    await page.goto("/auth/change-password");

    await expect(
      page.getByRole("heading", { name: "Change Password" }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByText("Enter your current password and choose a new password."),
    ).toBeVisible();

    await expect(page.getByLabel("Current Password")).toBeVisible();
    await expect(
      page.getByLabel("New Password", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Confirm New Password")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Change Password" }),
    ).toBeVisible();
  });

  test("change-password surfaces a weak-password validation error", async ({
    page,
  }) => {
    await page.goto("/auth/change-password");
    await expect(
      page.getByRole("heading", { name: "Change Password" }),
    ).toBeVisible({ timeout: 20_000 });

    // A too-short / weak password fails the live passwordSchema check, which
    // renders inline validation messages and disables submit. We never submit
    // a real password change - asserting the validation is enough and keeps the
    // admin credential intact for the logout test below.
    await page.getByLabel("New Password", { exact: true }).fill("weak");

    // The live passwordSchema check renders zod issue messages. These exact
    // strings only appear in the dynamic validation list (the static helper
    // text below the field uses different wording), so matching them proves the
    // validation actually fired.
    await expect(
      page.getByText("Password must be at least 8 characters", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Password must contain at least one uppercase letter"),
    ).toBeVisible();

    // Submit is disabled while the new password is invalid.
    await expect(
      page.getByRole("button", { name: "Change Password" }),
    ).toBeDisabled();
  });

  test("change-password surfaces a password-mismatch error", async ({
    page,
  }) => {
    await page.goto("/auth/change-password");
    await expect(
      page.getByRole("heading", { name: "Change Password" }),
    ).toBeVisible({ timeout: 20_000 });

    // A strong-but-mismatched confirmation triggers the inline mismatch hint
    // and keeps submit disabled. Again, nothing is submitted.
    await page
      .getByLabel("New Password", { exact: true })
      .fill("StrongPass123");
    await page.getByLabel("Confirm New Password").fill("StrongPass124");

    await expect(page.getByText("Passwords do not match")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Change Password" }),
    ).toBeDisabled();
  });

  test("auth settings lists the enabled credential strategy", async ({
    page,
  }) => {
    await page.goto("/auth/settings");

    await expect(
      page.getByRole("heading", { name: "Authentication Settings" }),
    ).toBeVisible({ timeout: 20_000 });

    // Strategies live behind the "Auth Strategies" tab; the default tab is
    // "Users & Roles", so switch to it first.
    const strategiesTab = page.getByRole("tab", { name: "Auth Strategies" });
    await expect(strategiesTab).toBeVisible();
    await strategiesTab.click();

    // The built-in credential strategy ("Email & Password") must be listed.
    await expect(page.getByText("Email & Password")).toBeVisible();

    // The reload-auth control confirms we landed on the strategies panel.
    await expect(
      page.getByRole("button", { name: "Reload Authentication" }),
    ).toBeVisible();
  });

  // MUST be last: signing out ends the session for the rest of the file.
  test("logging out via the user menu drops the session", async ({ page }) => {
    await page.goto("/");

    // The user-menu trigger in the navbar is labelled with the admin's name.
    const userMenu = page.getByRole("button", { name: ADMIN_NAME });
    await expect(userMenu).toBeVisible({ timeout: 20_000 });
    await userMenu.click();

    // The auth plugin contributes a "Logout" item to the user menu.
    const logout = page.getByRole("menuitem", { name: "Logout" });
    await expect(logout).toBeVisible();
    await logout.click();

    // signOut clears the session in place: the navbar swaps the authenticated
    // user menu for an anonymous "Login" link pointing at the login gate, and
    // the admin's user-menu trigger disappears. We assert these durable signals
    // rather than a hard redirect (the dashboard stays mounted).
    const loginLink = page.getByRole("link", { name: "Login" });
    await expect(loginLink).toBeVisible({ timeout: 20_000 });
    await expect(loginLink).toHaveAttribute("href", "/auth/login");
    await expect(
      page.getByRole("button", { name: ADMIN_NAME }),
    ).toHaveCount(0);
  });
});
