import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Navigation, sidebar & access (cross-cutting).
 *
 * Exercises the authenticated app shell: the left SIDEBAR lists feature nav
 * grouped by section and its entries navigate to the right SPA routes (rendering
 * the destination `<h2>` from `PageLayout`, never the catch-all "Route not
 * found"); the user menu is now ACCOUNT-ONLY (logout/theme/about, no feature
 * nav); the global search affordance is present. Edge cases: an unknown route
 * renders NotFound, and the AI chat route renders its shell with no model.
 *
 * Runs in the authenticated `chromium` project (admin session from
 * `auth.setup.ts`) at the default desktop viewport, so the sidebar is visible
 * (it is `hidden md:flex`). No data prerequisites.
 */

test.describe.configure({ mode: "serial" });

// Matches the onboarded admin created by auth.setup.ts (support/auth.ts).
const ADMIN_NAME = "E2E Admin";

test.describe("navigation, sidebar & access", () => {
  test("the app shell renders the logo and the global search affordance", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "Checkstack", level: 1 }),
    ).toBeVisible();

    const search = page.getByRole("button", { name: "Open search" });
    await expect(search).toBeVisible();
    await expect(search).toContainText("Search");

    await expect(
      page.getByRole("heading", { name: "Route not found" }),
    ).toHaveCount(0);
  });

  test("the sidebar lists grouped feature navigation", async ({ page }) => {
    await page.goto("/");

    const sidebar = page.getByRole("navigation", { name: "Primary" });
    await expect(sidebar).toBeVisible({ timeout: 15_000 });

    // Section headers (collapsible group buttons) for the admin (sees all).
    await expect(
      sidebar.getByRole("button", { name: "Reliability" }),
    ).toBeVisible();
    await expect(
      sidebar.getByRole("button", { name: "Configuration" }),
    ).toBeVisible();

    // Key entries are links directly in the rail (no menu to open).
    await expect(
      sidebar.getByRole("link", { name: "Dashboard", exact: true }),
    ).toBeVisible();
    await expect(
      sidebar.getByRole("link", { name: "Automations" }),
    ).toBeVisible();
    await expect(
      sidebar.getByRole("link", { name: "Health Checks" }),
    ).toBeVisible();
  });

  test("the user menu is account-only (logout present, no feature nav)", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("button", { name: ADMIN_NAME }).click();

    // Account actions live here now.
    await expect(page.getByText("Logout")).toBeVisible();
    // The old grouped feature nav is gone from the menu (it moved to the
    // sidebar). The menu must NOT render section headers like "Reliability"
    // as menu labels - assert the menu contains no such grouping.
    const menu = page.getByRole("menu");
    await expect(menu.getByText("Reliability")).toHaveCount(0);
  });

  test("the Automations sidebar entry navigates to the automation list", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Automations" }).click();

    await expect(page).toHaveURL(/\/automation\/?$/, { timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: "Automations", level: 2 }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Route not found" }),
    ).toHaveCount(0);
  });

  test("the Health Checks sidebar entry navigates to the config page", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Health Checks" }).click();

    await expect(page).toHaveURL(/\/healthcheck\/config$/, { timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: "Health Checks", level: 2 }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Route not found" }),
    ).toHaveCount(0);
  });

  test("the Catalog sidebar entry navigates to the catalog page", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Catalog", exact: true }).click();

    await expect(page).toHaveURL(/\/catalog\/?$/, { timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: "Catalog", level: 2 }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Route not found" }),
    ).toHaveCount(0);
  });

  test("an unknown route renders the NotFound page", async ({ page }) => {
    await page.goto("/this-does-not-exist");

    await expect(
      page.getByRole("heading", { name: "Route not found", level: 2 }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: "Checkstack", level: 1 }),
    ).toBeVisible();
  });

  test("the AI chat route renders its shell without crashing (no model configured)", async ({
    page,
  }) => {
    await page.goto("/ai/chat");

    await expect(
      page.getByRole("heading", { name: "AI assistant", level: 2 }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: "Route not found" }),
    ).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(
      "This page failed to load",
    );
  });
});
