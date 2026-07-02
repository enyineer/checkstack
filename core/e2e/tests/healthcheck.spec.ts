import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Health checks config CRUD + history. Drives the authenticated admin through
 * the real UI.
 *
 * Boot-once variant: the backend boots and the DB is reset ONCE, then all
 * specs run in PARALLEL against that single shared DB. The DB is therefore
 * non-empty and shared, so this file is fully data-isolated: every entity it
 * creates is namespaced with a unique-per-run suffix (`NS`) so parallel specs
 * never collide, and no test asserts on global table state (no empty-state, no
 * global counts). Tests within this file still run serially (the create -> edit
 * -> delete chain).
 *
 * Routes (SPA): /healthcheck/config (list), /healthcheck/config/create
 * (strategy picker), /healthcheck/config/:id/edit (IDE), /healthcheck/history.
 *
 * The HTTP/HTTPS and DNS strategies carry no REQUIRED strategy config (only a
 * defaulted `timeout`), so a check is valid to save with just a Name — which is
 * what lets the happy-path create succeed without touching the strategy form.
 */
test.describe.configure({ mode: "serial" });

const NAV_TIMEOUT = 30_000;

// Unique per run so parallel specs sharing one DB never collide.
const NS = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;

test.describe("health checks", () => {
  const checkName = `E2E HTTP Check-${NS}`;

  test("strategy picker lists available strategies grouped by category", async ({
    page,
  }) => {
    await page.goto("/healthcheck/config/create", { timeout: NAV_TIMEOUT });

    await expect(
      page.getByRole("heading", { name: "Create Health Check", level: 2 }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(
      page.getByPlaceholder("Search strategies..."),
    ).toBeVisible();

    // The "Networking" category groups the HTTP + DNS strategies, both of which
    // ship as auto-discovered backend plugins.
    await expect(
      page.getByRole("heading", { name: "Networking" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "HTTP/HTTPS Health Check" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "DNS Health Check" }),
    ).toBeVisible();

    // Search filters the grid: typing "DNS" hides the HTTP card.
    await page.getByPlaceholder("Search strategies...").fill("DNS");
    await expect(
      page.getByRole("heading", { name: "DNS Health Check" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "HTTP/HTTPS Health Check" }),
    ).toBeHidden();

    // A search with no matches shows the no-results copy.
    await page
      .getByPlaceholder("Search strategies...")
      .fill("zzz-no-such-strategy");
    await expect(
      page.getByText("No strategies match your search."),
    ).toBeVisible();
  });

  test("editor blocks save and surfaces a validation issue when the name is empty", async ({
    page,
  }) => {
    await page.goto("/healthcheck/config/create", { timeout: NAV_TIMEOUT });

    await page
      .getByRole("heading", { name: "HTTP/HTTPS Health Check" })
      .click();

    // Lands in the IDE for a brand-new check.
    await expect(
      page.getByRole("heading", { name: "New Health Check", level: 2 }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });

    // Name starts empty → Save is disabled and the status bar lists the issue.
    const saveButton = page.getByRole("button", { name: "Save" });
    await expect(saveButton).toBeDisabled();
    await expect(page.getByText("Name is required")).toBeVisible();

    // Typing a name clears the issue and enables Save.
    await page.getByLabel("Name").fill(checkName);
    await expect(page.getByText("Name is required")).toBeHidden();
    await expect(page.getByText("No issues found")).toBeVisible();
    await expect(saveButton).toBeEnabled();

    // Clearing the name re-blocks save (round-trip guard).
    await page.getByLabel("Name").fill("");
    await expect(page.getByText("Name is required")).toBeVisible();
    await expect(saveButton).toBeDisabled();
  });

  test("creating a check saves it and it appears in the config list", async ({
    page,
  }) => {
    await page.goto("/healthcheck/config/create", { timeout: NAV_TIMEOUT });

    await page
      .getByRole("heading", { name: "HTTP/HTTPS Health Check" })
      .click();

    await expect(
      page.getByRole("heading", { name: "New Health Check", level: 2 }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });

    // Fill the required Name and a non-warning interval.
    await page.getByLabel("Name").fill(checkName);
    await page.getByLabel("Interval (seconds)").fill("120");

    const saveButton = page.getByRole("button", { name: "Save" });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    // Create navigates back to the config list, where the new row shows up.
    await expect(
      page.getByRole("heading", { name: "Health Checks", level: 2 }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });

    // Scoped to OUR namespaced check; the shared DB may hold rows from other
    // parallel specs, so we never assert global counts or the empty state.
    const row = page.getByRole("row", { name: new RegExp(checkName) });
    await expect(row).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(row.getByText("HTTP/HTTPS Health Check")).toBeVisible();
    await expect(row.getByText("120", { exact: true })).toBeVisible();
    await expect(row.getByText("Active")).toBeVisible();
  });

  test("opening the edit IDE seeds the saved values", async ({ page }) => {
    await page.goto("/healthcheck/config", { timeout: NAV_TIMEOUT });

    const row = page.getByRole("row", { name: new RegExp(checkName) });
    await expect(row).toBeVisible({ timeout: NAV_TIMEOUT });

    // Edit button carries the title "Edit configuration".
    await row.getByRole("button", { name: "Edit configuration" }).click();

    // Edit-mode title is `Edit: <name>`; the strategy is the subtitle.
    await expect(
      page.getByRole("heading", { name: `Edit: ${checkName}`, level: 2 }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });

    // Form is seeded from the saved configuration.
    await expect(page.getByLabel("Name")).toHaveValue(checkName);
    await expect(page.getByLabel("Interval (seconds)")).toHaveValue("120");
  });

  test("history page renders its run feed for a global manager", async ({
    page,
  }) => {
    // Regression guard for the manage-or-team-grant history model: the
    // global History feed (`getDetailedHistory`) is authorized in the HANDLER
    // (global `configuration.manage` → full feed), so this drives the real
    // authorization path, not just the route guard. The admin holds the
    // wildcard rule, so the page must render its Run History table (runs may
    // legitimately be empty - the created check may not have fired yet).
    await page.goto("/healthcheck/history", { timeout: NAV_TIMEOUT });

    await expect(
      page.getByRole("heading", { name: "Health Check History" }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(
      page.getByRole("heading", { name: "Run History" }),
    ).toBeVisible();
    // Must NOT be the Access-Denied gate or the catch-all 404.
    await expect(page.locator("body")).not.toContainText("Access Denied");
    await expect(page.locator("body")).not.toContainText("Route not found");
  });

  test("deleting a check requires confirmation and removes it from the list", async ({
    page,
  }) => {
    await page.goto("/healthcheck/config", { timeout: NAV_TIMEOUT });

    const row = page.getByRole("row", { name: new RegExp(checkName) });
    await expect(row).toBeVisible({ timeout: NAV_TIMEOUT });

    // Delete button carries the title "Delete configuration".
    await row.getByRole("button", { name: "Delete configuration" }).click();

    // ConfirmationModal copy.
    await expect(
      page.getByRole("heading", { name: "Delete Health Check" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Are you sure you want to delete this health check configuration? This action cannot be undone.",
      ),
    ).toBeVisible();

    await page.getByRole("button", { name: "Delete", exact: true }).click();

    // The specific namespaced row is gone. Scoped to our own check only — the
    // shared DB may still hold rows created by other parallel specs, so we never
    // assert a global empty state.
    await expect(row).toBeHidden({ timeout: NAV_TIMEOUT });
  });
});
