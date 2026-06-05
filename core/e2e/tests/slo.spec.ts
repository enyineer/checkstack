import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Authenticated E2E coverage for the SLO app area.
 *
 * Routes under test (the SLO plugin mounts every route under `/slo`):
 *   - `/slo/`        overview dashboard
 *   - `/slo/config`  manage objectives (create / edit / delete)
 *   - `/slo/:id`     objective detail
 *
 * The whole file shares ONE freshly reset, empty Postgres database (only the
 * admin exists at boot), so the tests run serially and the empty-state
 * assertions are ordered before the create/edit ones. SLOs target a system, so
 * the first create test seeds a system through the catalog UI.
 */
test.describe.configure({ mode: "serial" });

// Unique suffix so created resources never clash across reruns sharing a DB.
const RUN_ID = Date.now();
const SYSTEM_NAME = `SLO E2E System ${RUN_ID}`;

test.describe("SLOs", () => {
  test("overview renders its empty state when no SLOs exist", async ({
    page,
  }) => {
    await page.goto("/slo/", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { name: "SLO Dashboard" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText("Service Level Objective performance across all systems"),
    ).toBeVisible();

    // Empty state copy from SloOverviewPage. The shared EmptyState component
    // renders its title as a paragraph, not a heading.
    await expect(page.getByText("No SLOs configured")).toBeVisible();

    // The empty state links to SLO management.
    await expect(
      page.getByRole("link", { name: "Manage SLOs" }).first(),
    ).toBeVisible();

    // We must not have landed on the catch-all 404.
    await expect(page.locator("body")).not.toContainText("Route not found");
  });

  test("config page renders its empty state when no objectives exist", async ({
    page,
  }) => {
    await page.goto("/slo/config", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { name: "SLO Management" }),
    ).toBeVisible({ timeout: 30_000 });

    // Empty state copy from SloConfigPage. The shared EmptyState component
    // renders its title as a paragraph, not a heading.
    await expect(page.getByText("No SLO objectives yet")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create your first SLO" }),
    ).toBeVisible();
  });

  test("create flow validates required system and target range", async ({
    page,
  }) => {
    // --- Seed a system via the catalog UI (SLOs target a system) ----------
    await page.goto("/catalog/config", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Catalog Management" }),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Add your first system" }).click();

    const systemDialog = page.getByRole("dialog");
    await expect(
      systemDialog.getByRole("heading", { name: "Create System" }),
    ).toBeVisible();
    await systemDialog.getByLabel("Name").fill(SYSTEM_NAME);
    await systemDialog
      .getByRole("button", { name: "Create System" })
      .click();

    // Toast confirms creation and the dialog closes.
    await expect(page.getByText("System created successfully")).toBeVisible();
    await expect(systemDialog).toBeHidden();

    // --- Open the SLO editor on the config page ---------------------------
    await page.goto("/slo/config", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "SLO Management" }),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Create your first SLO" }).click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Create SLO Objective" }),
    ).toBeVisible();

    // EDGE: submitting with no system selected surfaces a validation toast.
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(
      page.getByText("Please select a system").first(),
    ).toBeVisible();
    // Dialog stays open so the user can correct the input.
    await expect(
      dialog.getByRole("heading", { name: "Create SLO Objective" }),
    ).toBeVisible();

    // Select the seeded system from the Radix Select (renders role=option).
    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: SYSTEM_NAME }).click();
    await expect(dialog.getByText(SYSTEM_NAME)).toBeVisible();

    // EDGE: a target above 100 is rejected (range is 0-100). Stacked toasts can
    // briefly coexist, so scope assertions to the first match.
    const targetInput = dialog.getByLabel("Availability Target (%)");
    await targetInput.fill("150");
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(
      page.getByText("Target must be between 0 and 100").first(),
    ).toBeVisible();

    // EDGE: a negative target is rejected too.
    await targetInput.fill("-5");
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(
      page.getByText("Target must be between 0 and 100").first(),
    ).toBeVisible();

    // EDGE: a window below 1 day is rejected.
    await targetInput.fill("99.9");
    const windowInput = dialog.getByLabel("Rolling Window (days)");
    await windowInput.fill("0");
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(
      page.getByText("Window must be at least 1 day").first(),
    ).toBeVisible();

    // --- Happy path: valid target + window creates the objective ----------
    await windowInput.fill("30");
    await dialog.getByRole("button", { name: "Create" }).click();

    await expect(page.getByText("SLO objective created")).toBeVisible();
    await expect(dialog).toBeHidden();

    // The new objective shows up in the objectives table with its system,
    // target and window.
    await expect(
      page.getByRole("cell", { name: SYSTEM_NAME }),
    ).toBeVisible();
    await expect(page.getByRole("cell", { name: "99.9%" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "30d" })).toBeVisible();
  });

  test("overview lists the created SLO and links to its detail page", async ({
    page,
  }) => {
    await page.goto("/slo/", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { name: "SLO Dashboard" }),
    ).toBeVisible({ timeout: 30_000 });

    // The empty state is gone now that an objective exists.
    await expect(page.getByText("No SLOs configured")).toHaveCount(0);

    // The objective card is a link titled with the system name; following it
    // lands on the detail page (title is "<target>% / <window>d SLO").
    const card = page.getByRole("link", { name: SYSTEM_NAME });
    await expect(card).toBeVisible();
    await card.click();

    await expect(
      page.getByRole("heading", { name: "99.9% / 30d SLO" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(`System: ${SYSTEM_NAME}`),
    ).toBeVisible();

    // Detail status cards are present.
    await expect(
      page.getByText("Current Availability"),
    ).toBeVisible();
    await expect(page.getByText("Error Budget", { exact: true })).toBeVisible();
    await expect(page.getByText("Burn Rate", { exact: true })).toBeVisible();
  });
});
