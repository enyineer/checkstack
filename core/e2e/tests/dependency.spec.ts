import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Dependencies & map area. Boots against a freshly reset, empty DB onboarded
 * with only the admin user, so every prerequisite (systems, the dependency
 * between them) is created here via the real UI. The whole file shares one DB,
 * so it runs serially and empty-state assertions come before the create flow.
 *
 * Routes under test:
 *   - /dependency/map           (interactive topology graph)
 *   - /catalog/config           (system creation + the dependency editor slot)
 *
 * Source of selectors:
 *   - DependencyMapPage.tsx  → heading "Dependency Map", graph toolbar buttons
 *   - CatalogConfigPage.tsx / SystemEditor.tsx → "Add System", "Create System"
 *   - DependencyEditor.tsx   → "Dependencies", "Add", "Create" inside the editor
 */
test.describe.configure({ mode: "serial" });

const RUN = Date.now();
const SOURCE_SYSTEM = `Web Frontend ${RUN}`;
const TARGET_SYSTEM = `Payments API ${RUN}`;

/**
 * Create a system through the Catalog Management UI. The fresh DB starts with
 * no systems, so the first call hits the empty-state "Add your first system"
 * button while later calls use the header "Add System" button — both open the
 * same SystemEditor dialog.
 */
async function createSystem({
  page,
  name,
}: {
  page: import("@playwright/test").Page;
  name: string;
}): Promise<void> {
  await page.goto("/catalog/config");
  await expect(
    page.getByRole("heading", { name: "Catalog Management" }),
  ).toBeVisible({ timeout: 30_000 });

  // The "Add System" header button is always present once the page renders;
  // the empty-state CTA shares the dialog, so target the stable header button.
  await page.getByRole("button", { name: "Add System" }).click();

  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Create System" }),
  ).toBeVisible();

  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Create System" }).click();

  // Dialog closes on success; the new system row appears in the management
  // table. Scope to the desktop table: the ResponsiveTable's display:none
  // MobileCardList duplicates the name, which would trip strict mode.
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("table").getByText(name, { exact: true }),
  ).toBeVisible();
}

test.describe("dependency map", () => {
  test("renders the map page with its instructional header and graph toolbar", async ({
    page,
  }) => {
    await page.goto("/dependency/map");

    // Page chrome always renders even with zero systems.
    await expect(
      page.getByRole("heading", { name: "Dependency Map" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(/Interactive topology view of system dependencies/),
    ).toBeVisible();

    // We must NOT be on the catch-all 404.
    await expect(page.locator("body")).not.toContainText("Route not found");

    // The graph toolbar (the page's filter/control surface) renders its
    // action buttons regardless of whether any systems exist.
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Fit", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save Layout" }),
    ).toBeVisible();

    // The legend (impact / direction key) is part of the toolbar surface.
    await expect(page.getByText("Legend")).toBeVisible();
  });

  test("shows an empty graph when there are no systems", async ({ page }) => {
    await page.goto("/dependency/map");
    await expect(
      page.getByRole("heading", { name: "Dependency Map" }),
    ).toBeVisible({ timeout: 30_000 });

    // With no systems the canvas renders no system nodes. The neither-created
    // system name must be absent from the graph.
    await expect(page.getByText(SOURCE_SYSTEM)).toHaveCount(0);
    await expect(page.getByText(TARGET_SYSTEM)).toHaveCount(0);

    // Save Layout is disabled until a node position changes (nothing to save).
    await expect(
      page.getByRole("button", { name: "Save Layout" }),
    ).toBeDisabled();
  });

  test("reflects a dependency created between two systems", async ({ page }) => {
    // Prereq: two systems via the catalog UI.
    await createSystem({ page, name: SOURCE_SYSTEM });
    await createSystem({ page, name: TARGET_SYSTEM });

    // Open the source system's editor and add an upstream dependency on the
    // target via the dependency editor slot (DependencyEditor.tsx).
    await page.goto("/catalog/config");
    await expect(
      page.getByRole("heading", { name: "Catalog Management" }),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: `Edit ${SOURCE_SYSTEM}` }).click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Edit System" }),
    ).toBeVisible();

    // The dependency editor section is injected into the system editor.
    await expect(
      dialog.getByText("Dependencies", { exact: true }),
    ).toBeVisible();

    // Reveal the add-dependency form.
    await dialog.getByRole("button", { name: "Add", exact: true }).click();

    // Pick the target system as the upstream dependency. The system picker is
    // the native <select> that carries the "Select a system..." placeholder
    // option (DependencyEditor.tsx) — scope to it rather than the first
    // combobox, since the add form also renders an impact-type select.
    await dialog
      .locator("select")
      .filter({ hasText: "Select a system..." })
      .selectOption({ label: TARGET_SYSTEM });

    await dialog.getByRole("button", { name: "Create" }).click();

    // The new upstream row renders under "Depends On".
    await expect(dialog.getByText("Depends On (1)")).toBeVisible();

    // Close the editor.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    // The map now shows both systems as graph nodes.
    await page.goto("/dependency/map");
    await expect(
      page.getByRole("heading", { name: "Dependency Map" }),
    ).toBeVisible({ timeout: 30_000 });

    await expect(page.getByText(SOURCE_SYSTEM)).toBeVisible();
    await expect(page.getByText(TARGET_SYSTEM)).toBeVisible();

    // A connected node renders its directional footer; the dependency wired the
    // source's "depends" count and the target's "used by" count.
    await expect(page.getByText("depends").first()).toBeVisible();
    await expect(page.getByText("used by").first()).toBeVisible();
  });
});
