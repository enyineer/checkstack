import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Health checks config CRUD + history. Drives the authenticated admin through
 * the real UI against a fresh, empty DB. The whole file shares ONE backend /
 * Postgres, so tests run serially and empty-state assertions come first.
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

test.describe("health checks", () => {
  // Unique per run so re-runs against a non-reset DB never collide. The DB is
  // reset per file, but uniqueness is cheap insurance and the brief asks for it.
  const stamp = Date.now();
  const checkName = `E2E HTTP Check ${stamp}`;

  test("config list shows the empty state before any checks exist", async ({
    page,
  }) => {
    await page.goto("/healthcheck/config", { timeout: NAV_TIMEOUT });

    // Page chrome.
    await expect(
      page.getByRole("heading", { name: "Health Checks", level: 2 }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(
      page.getByRole("button", { name: "Create Check" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "View History" }),
    ).toBeVisible();

    // ListEmptyState renders "No {resource} yet" (a styled <p>, not a heading)
    // plus the descriptive copy.
    await expect(page.getByText("No health checks yet")).toBeVisible();
    await expect(
      page.getByText(
        "No health checks have been configured yet. Create one to start monitoring a system.",
      ),
    ).toBeVisible();
  });

  test("history page renders its empty run table initially", async ({
    page,
  }) => {
    await page.goto("/healthcheck/history", { timeout: NAV_TIMEOUT });

    await expect(
      page.getByRole("heading", { name: "Health Check History", level: 2 }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(
      page.getByRole("heading", { name: "Run History" }),
    ).toBeVisible();
    // Empty in-table message from HealthCheckRunsTable's default. Scope to the
    // desktop table cell: the ResponsiveTable's display:none MobileCardList
    // renders the same empty-state text, which would trip strict mode.
    await expect(
      page.getByRole("cell", { name: "No health check runs found." }),
    ).toBeVisible();
  });

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

    // Row is gone; with no checks left the empty state returns.
    await expect(row).toBeHidden({ timeout: NAV_TIMEOUT });
    await expect(page.getByText("No health checks yet")).toBeVisible();
  });
});
