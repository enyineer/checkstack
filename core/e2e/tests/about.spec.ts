import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * About area (platform info, license & versions).
 *
 * The About plugin (`core/about-frontend`) registers a single SPA route at
 * `/about/` (pluginId "about" + page path "/") that renders `AboutPage` inside
 * `PageLayout`, and contributes an "About Checkstack" entry into the account
 * (user) menu's bottom slot. The page is structured into cards:
 *  - a hero card titled "Checkstack" with a GitHub repository link + contact
 *    mailto link;
 *  - a "License" card naming the Elastic License 2.0 (ELv2);
 *  - a "Version Information" card that fetches `/api/about` and renders the
 *    "Checkstack Core" version as a `v<version>` badge plus a loaded-plugins
 *    table.
 *
 * `PageLayout`/`PageHeader` renders the page title as an `<h2>` and `CardTitle`
 * as an `<h3>`, so these assertions are role + level based. The core version is
 * matched by SHAPE (a `v`-prefixed dotted version), never by an exact literal
 * that would churn on every release.
 *
 * Runs in the authenticated `chromium` project (admin session). No data
 * prerequisites.
 */

test.describe.configure({ mode: "serial" });

const NAV_TIMEOUT = 30_000;

// Matches the onboarded admin created by auth.setup.ts (support/auth.ts).
const ADMIN_NAME = "E2E Admin";

test.describe("about area", () => {
  test("the About page renders its heading, hero links and license", async ({
    page,
  }) => {
    await page.goto("/about/");

    // Page title (PageHeader renders the title as an <h2>).
    await expect(
      page.getByRole("heading", { name: "About Checkstack", level: 2 }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });

    // Never the SPA catch-all.
    await expect(
      page.getByRole("heading", { name: "Route not found" }),
    ).toHaveCount(0);

    // Hero card title + outbound links.
    await expect(
      page.getByRole("heading", { name: "Checkstack", level: 3 }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "GitHub Repository" }),
    ).toHaveAttribute("href", "https://github.com/enyineer/checkstack");

    // License card (CardTitle is an <h3>) names the Elastic License 2.0.
    await expect(
      page.getByRole("heading", { name: "License", level: 3 }),
    ).toBeVisible();
    await expect(
      page.getByText("Elastic License 2.0 (ELv2)", { exact: true }),
    ).toBeVisible();
  });

  test("the Version Information card shows the core version in a version-shaped badge", async ({
    page,
  }) => {
    await page.goto("/about/");

    await expect(
      page.getByRole("heading", { name: "Version Information", level: 3 }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });

    // The core version row labels (stable) and a SHAPE-matched version badge.
    // `/api/about` is fetched on mount; wait for the label, then the badge.
    await expect(
      page.getByText("Checkstack Core", { exact: true }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });

    // Badge renders `v<version>` (e.g. "v1.2.3", "v1.2.3-beta.4"); assert the
    // shape, not an exact literal that churns every release.
    await expect(
      page.getByText(/^v\d+\.\d+\.\d+/),
    ).toBeVisible();
  });

  test("the account menu links to the About page", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: ADMIN_NAME }).click();

    // The desktop UserMenu is a Radix Popover (role="dialog"), not a menu.
    const menu = page.getByRole("dialog");
    await expect(menu).toBeVisible({ timeout: NAV_TIMEOUT });
    const aboutItem = menu.getByRole("menuitem", { name: "About Checkstack" });
    await expect(aboutItem).toBeVisible();

    await aboutItem.click();

    await expect(page).toHaveURL(/\/about\/?$/, { timeout: NAV_TIMEOUT });
    await expect(
      page.getByRole("heading", { name: "About Checkstack", level: 2 }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });
  });
});
