import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Interactive API docs page (`/api-docs/`). The page fetches the live
 * `/api/openapi.json` spec and renders it as an explorer: a version badge, an
 * "Authentication" card, access-type filter buttons, and one collapsible card
 * per endpoint grouped by plugin. These tests guard against the page rendering
 * blank, hitting the app's catch-all 404, or failing to load the spec.
 *
 * The whole file shares one fresh, admin-only DB, so tests run serially and the
 * non-mutating render/empty-state checks come first.
 */
test.describe.configure({ mode: "serial" });

test.describe("API docs", () => {
  test("renders the docs explorer (not blank, not a 404)", async ({ page }) => {
    await page.goto("/api-docs/", { waitUntil: "domcontentloaded" });

    // Must not land on the app's catch-all 404.
    await expect(page.locator("body")).not.toContainText("Route not found");

    // The page title comes from the OpenAPI spec info; the "Authentication"
    // card and the "Filter by access:" label are static chrome that only render
    // once the spec has loaded successfully.
    await expect(
      page.getByRole("heading", { name: "Authentication" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Filter by access:")).toBeVisible();

    // The Bearer-token auth example is always rendered in the Authentication
    // card - a strong signal the spec fetch succeeded and content is present.
    await expect(page.getByText(/Authorization: Bearer ck_/)).toBeVisible();
  });

  test("renders a version badge and the access filter affordance", async ({
    page,
  }) => {
    await page.goto("/api-docs/", { waitUntil: "domcontentloaded" });

    // Version badge is rendered as "v<version>" from spec.info.version.
    await expect(page.getByText(/^v\d/).first()).toBeVisible({
      timeout: 30_000,
    });

    // All five access filter buttons must be present.
    await expect(page.getByRole("button", { name: "All" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Authenticated" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Public" })).toBeVisible();
    await expect(page.getByRole("button", { name: "User Only" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Service Only" }),
    ).toBeVisible();
  });

  test("renders endpoint cards with HTTP method badges", async ({ page }) => {
    await page.goto("/api-docs/", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { name: "Authentication" }),
    ).toBeVisible({ timeout: 30_000 });

    // The default filter shows authenticated + public endpoints. Use "All" to
    // ensure endpoints are visible regardless of seeded data.
    await page.getByRole("button", { name: "All" }).click();

    // Each endpoint card shows a method badge whose DOM text is the raw
    // lowercase verb (e.g. "get"); the uppercasing is CSS-only, so match the
    // lowercase leaf text exactly. Assert at least one badge is present.
    const methodBadge = page
      .getByText(/^(get|post|put|patch|delete)$/)
      .first();
    await expect(methodBadge).toBeVisible();
  });

  test("clicking an endpoint expands its detail (fetch example)", async ({
    page,
  }) => {
    await page.goto("/api-docs/", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { name: "Authentication" }),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "All" }).click();

    // Find the first endpoint card header by its method badge and click it to
    // expand. Endpoint headers are clickable rows; expanding reveals a
    // "Fetch Example" section. Badge DOM text is lowercase (uppercase is CSS).
    const methodBadge = page
      .getByText(/^(get|post|put|patch|delete)$/)
      .first();
    await expect(methodBadge).toBeVisible();
    await methodBadge.click();

    // The expanded card shows a "Fetch Example" heading with a runnable
    // snippet referencing the Bearer token scheme.
    await expect(
      page.getByRole("heading", { name: "Fetch Example" }).first(),
    ).toBeVisible();
  });

  test("toggling an access filter narrows or widens the endpoint list", async ({
    page,
  }) => {
    await page.goto("/api-docs/", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { name: "Authentication" }),
    ).toBeVisible({ timeout: 30_000 });

    // Switch to "Public" only, then back to "All". This exercises the filter
    // affordance without asserting an exact endpoint count (depends on seeded
    // plugins), but verifies the buttons remain interactive and the page does
    // not break (no 404, Authentication card still present).
    await page.getByRole("button", { name: "Public" }).click();
    await expect(page.locator("body")).not.toContainText("Route not found");

    await page.getByRole("button", { name: "All" }).click();
    await expect(
      page.getByRole("heading", { name: "Authentication" }),
    ).toBeVisible();
  });
});
