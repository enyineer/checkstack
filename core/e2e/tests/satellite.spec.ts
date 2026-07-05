import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Satellites read/create UI (route `/satellite/`).
 *
 * Boot-once variant: the backend boots and the DB is reset ONCE, then all
 * boot-once specs run in PARALLEL against that single shared DB. The DB is
 * therefore non-empty and shared, so this file is fully data-isolated: every
 * satellite it creates is namespaced with a unique-per-run suffix (`NS`) so
 * parallel specs never collide, and no test asserts on global table state (no
 * empty-state, no global counts). Tests within this file still run serially
 * (the chrome -> dialog -> create chain).
 */
test.describe.configure({ mode: "serial" });

// Unique per run so parallel specs sharing one DB never collide.
const NS = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
const SATELLITE_NAME = `e2e-satellite-${NS}`;
const SATELLITE_REGION = `eu-${NS}`;

/**
 * The list renders each satellite name inside the table (and, on mobile, a
 * card). The namespaced name is unique per run, so matching the name text
 * directly is enough to scope to our own entity without asserting global state.
 */
function satelliteName(
  page: import("@playwright/test").Page,
  name: string,
) {
  // Scope to the desktop table: the ResponsiveTable also renders a
  // display:none MobileCardList with the same name, which would otherwise trip
  // strict mode (two matches for the same namespaced satellite).
  return page.getByRole("table").getByText(name, { exact: true });
}

test.describe("satellites", () => {
  test("renders the page chrome with title, subtitle and create action", async ({
    page,
  }) => {
    await page.goto("/satellite/", { waitUntil: "load", timeout: 30_000 });

    // PageLayout renders the title as an <h2> heading.
    await expect(
      page.getByRole("heading", { name: "Satellites" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Manage distributed satellite nodes for remote health check execution",
      ),
    ).toBeVisible();

    // The header action button to register a satellite.
    await expect(
      page.getByRole("button", { name: "Create Satellite", exact: true }),
    ).toBeVisible();

    // We must NOT be on the catch-all 404.
    await expect(page.locator("body")).not.toContainText("Route not found");
  });

  test("the create affordance opens the registration dialog", async ({
    page,
  }) => {
    await page.goto("/satellite/", { waitUntil: "load", timeout: 30_000 });

    await page
      .getByRole("button", { name: "Create Satellite", exact: true })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "Create Satellite" }),
    ).toBeVisible();
    await expect(
      dialog.getByText(
        "Deploy a satellite node to run health checks from a remote location.",
      ),
    ).toBeVisible();

    // The registration form fields are present.
    await expect(dialog.getByLabel("Name")).toBeVisible();
    await expect(dialog.getByLabel("Region")).toBeVisible();
    await expect(
      dialog.getByPlaceholder("EU West Production"),
    ).toBeVisible();
    await expect(dialog.getByPlaceholder("eu-west-1")).toBeVisible();

    // Closing the dialog without creating anything dismisses the dialog. We
    // scope to the dialog only - the shared DB may already hold satellites
    // from other parallel specs, so we never assert a global empty state.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("creates a namespaced satellite and lists it", async ({ page }) => {
    await page.goto("/satellite/", { waitUntil: "load", timeout: 30_000 });

    await page
      .getByRole("button", { name: "Create Satellite", exact: true })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Name").fill(SATELLITE_NAME);
    await dialog.getByLabel("Region").fill(SATELLITE_REGION);

    // The dialog's submit button shares the "Create Satellite" label with the
    // header action, so scope the click to the dialog.
    await dialog
      .getByRole("button", { name: "Create Satellite", exact: true })
      .click();

    // On success the dialog switches to the credentials view (it does not
    // auto-close); the one-time token must be acknowledged via "Done".
    await expect(
      dialog.getByRole("heading", { name: "Satellite Created" }),
    ).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Our namespaced satellite now appears in the list. Scoped to our own
    // entity only - we never assert a global count on the shared DB.
    await expect(satelliteName(page, SATELLITE_NAME)).toBeVisible({
      timeout: 30_000,
    });
  });
});
