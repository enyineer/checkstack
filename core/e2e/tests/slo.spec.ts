import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Authenticated E2E coverage for the SLO app area.
 *
 * Routes under test (the SLO plugin mounts every route under `/slo`):
 *   - `/slo/`        overview dashboard
 *   - `/slo/config`  manage objectives (create / edit / delete)
 *   - `/slo/:id`     objective detail
 *
 * Boot-once variant: the backend boots and the DB is reset ONCE, then all
 * specs run in PARALLEL against that single shared DB. The DB is therefore
 * non-empty and shared, so this file is fully data-isolated: every entity it
 * creates is namespaced with a unique-per-run suffix (`NS`) so parallel specs
 * never collide, and no test asserts on global table state (no empty-state, no
 * global counts). Tests within this file still run serially (the
 * seed-system -> create -> list chain). SLOs target a system, so the create
 * test seeds its own namespaced system through the catalog UI.
 */
test.describe.configure({ mode: "serial" });

// Unique per run so parallel specs sharing one DB never collide.
const NS = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
const SYSTEM_NAME = `SLO E2E System ${NS}`;

test.describe("SLOs", () => {
  test("create flow validates required system and target range", async ({
    page,
  }) => {
    // --- Seed a system via the catalog UI (SLOs target a system) ----------
    await page.goto("/catalog/config", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Catalog Management" }),
    ).toBeVisible({ timeout: 30_000 });

    // The "Add your first system" CTA only renders on an empty catalog; on a
    // shared, non-empty DB other specs may have already seeded systems, so use
    // the always-present "Add System" header button instead.
    await page.getByRole("button", { name: "Add System" }).first().click();

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

    // The "Create your first SLO" CTA only renders on an empty objectives list;
    // on a shared DB other specs may have created objectives, so use the
    // always-present "Create SLO" header button instead.
    await page.getByRole("button", { name: "Create SLO", exact: true }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Create SLO Objective" }),
    ).toBeVisible();

    // EDGE: the editor is now disabled-until-valid. With no system selected the
    // form is invalid, so the Create button is disabled rather than surfacing a
    // toast on click.
    const createButton = dialog.getByRole("button", { name: "Create" });
    await expect(createButton).toBeDisabled();

    // Select the seeded system from the Radix Select (renders role=option).
    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: SYSTEM_NAME }).click();
    // The system control's value now shows the selection. Scope to the first
    // combobox: a plain getByText would also match the native <select> option.
    await expect(dialog.getByRole("combobox").first()).toContainText(
      SYSTEM_NAME,
    );

    // With a system selected and the default valid target/window, Create enables.
    await expect(createButton).toBeEnabled();

    // EDGE: a target above 100 is rejected (range is 0-100). The editor now
    // shows an inline error (revealed on blur) and keeps Create disabled.
    const targetInput = dialog.getByLabel("Availability Target (%)");
    await targetInput.fill("150");
    await targetInput.blur();
    await expect(
      dialog.getByText("Target must be between 0 and 100"),
    ).toBeVisible();
    await expect(createButton).toBeDisabled();

    // EDGE: a negative target is rejected too.
    await targetInput.fill("-5");
    await targetInput.blur();
    await expect(
      dialog.getByText("Target must be between 0 and 100"),
    ).toBeVisible();
    await expect(createButton).toBeDisabled();

    // EDGE: a window below 1 day is rejected with its own inline error.
    await targetInput.fill("99.9");
    const windowInput = dialog.getByLabel("Rolling Window (days)");
    await windowInput.fill("0");
    await windowInput.blur();
    await expect(
      dialog.getByText("Window must be at least 1 day"),
    ).toBeVisible();
    await expect(createButton).toBeDisabled();

    // --- Happy path: valid target + window re-enables Create and submits ---
    await windowInput.fill("30");
    await expect(createButton).toBeEnabled();
    await createButton.click();

    await expect(page.getByText("SLO objective created")).toBeVisible();
    await expect(dialog).toBeHidden();

    // The new objective shows up in the objectives table. Scope to OUR
    // namespaced system's row only - the shared DB may hold other specs'
    // objectives, so we never assert on global table contents. The target and
    // window values are not unique per run, so we assert them within our row.
    const objectiveRow = page.getByRole("row", { name: new RegExp(SYSTEM_NAME) });
    await expect(objectiveRow).toBeVisible();
    await expect(objectiveRow).toContainText("99.9%");
    await expect(objectiveRow).toContainText("30d");
  });

  test("overview lists the created SLO and links to its detail page", async ({
    page,
  }) => {
    await page.goto("/slo/", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { name: "SLO Dashboard" }),
    ).toBeVisible({ timeout: 30_000 });

    // The objective card is a link titled with the namespaced system name;
    // following it lands on the detail page (title is "<target>% / <window>d
    // SLO"). Scoped to our own card - we never assert a global empty state or
    // count on the shared DB.
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
