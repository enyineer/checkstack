import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Dependencies & map area.
 *
 * Boot-once variant: the backend boots and the DB is reset ONCE, then all
 * boot-once specs run in PARALLEL against that single shared DB. The DB is
 * therefore non-empty and shared, so this file is fully data-isolated: every
 * system it creates (and the dependency between them) is namespaced with a
 * unique-per-run suffix (`NS`) so parallel specs never collide, and no test
 * asserts on global table state (no empty graph, no "no systems", no global
 * counts). Tests within this file still run serially (the create -> wire ->
 * verify chain).
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

// Unique per run so parallel specs sharing one DB never collide.
const NS = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
const SOURCE_SYSTEM = `Web Frontend ${NS}`;
const TARGET_SYSTEM = `Payments API ${NS}`;

// A dedicated read-only actor for the map-visibility regression test. Fresh
// self-registration yields a plain member whose default role carries
// `dependency.dependency.read` + `dependency.map.read` (both `isDefault`) but
// NO manage rule on any system — the exact cohort that lost all map edges.
const READONLY_MEMBER = {
  name: `Dep ReadOnly ${NS}`,
  email: `dep-readonly-${NS}@checkstack.local`,
  // Satisfies the register passwordSchema: >= 8 chars, upper, lower, number.
  password: "DepReadonlyPass123",
};

/**
 * Create a system through the Catalog Management UI. The shared DB may already
 * hold systems from other parallel specs, so we always target the stable
 * header "Add System" button rather than any empty-state CTA.
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

    // Page chrome always renders regardless of how many systems exist.
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

  test("reflects a dependency created between two systems", async ({ page }) => {
    // Prereq: two namespaced systems via the catalog UI.
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

    // The map now shows BOTH of our namespaced systems as graph nodes. The
    // shared DB may also contain systems created by other parallel specs, so
    // we only assert that OUR systems are present (never a global count).
    await page.goto("/dependency/map");
    await expect(
      page.getByRole("heading", { name: "Dependency Map" }),
    ).toBeVisible({ timeout: 30_000 });

    await expect(page.getByText(SOURCE_SYSTEM)).toBeVisible();
    await expect(page.getByText(TARGET_SYSTEM)).toBeVisible();

    // A connected node renders its directional footer; the dependency wired the
    // source's "depends" count and the target's "used by" count. Other specs'
    // nodes may also render these labels, so scope to "first" presence only.
    await expect(page.getByText("depends").first()).toBeVisible();
    await expect(page.getByText("used by").first()).toBeVisible();

    // Sanity for the read-only regression test below: the admin DOES get a
    // rendered React Flow edge element, proving the locator is the right
    // primitive before we assert it for the member. Attachment (not
    // visibility) is the signal: React Flow only creates the edge element
    // when it can resolve both handles, and Playwright's visibility check
    // false-negatives on SVG edges (a horizontal edge path has a zero-height
    // bounding box and reads as "hidden" even when painted).
    await expect(page.locator(".react-flow__edge").first()).toBeAttached();
  });

  test("shows edges to a read-only member without manage access on any system", async ({
    browser,
  }) => {
    // Regression guard: React Flow silently drops every edge whose source node
    // has no source handle, and the source handle used to be rendered only for
    // systems the user may MANAGE. A plain member (read + map access via the
    // default role, no manage grants) therefore saw all system nodes but ZERO
    // edges. The handle must always render; manage access gates only
    // drag-to-connect (see SystemNode.tsx).
    //
    // Registration + a second context is a long flow; give it room.
    test.setTimeout(120_000);

    // Self-register a dedicated namespaced member in a fresh context (the
    // rlac-team-scoped.spec.ts pattern), so this never depends on or perturbs
    // the shared MEMBER session used by permissions.spec.ts. newContext()
    // inherits the project's `use.storageState` (the admin session), so start
    // it explicitly session-less.
    const memberContext = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const memberPage = await memberContext.newPage();
    try {
      await memberPage.goto("/auth/register");
      await expect(
        memberPage.getByRole("heading", { name: "Create your account" }),
      ).toBeVisible({ timeout: 30_000 });
      await memberPage.locator("#name").fill(READONLY_MEMBER.name);
      await memberPage.locator("#email").fill(READONLY_MEMBER.email);
      await memberPage.locator("#password").fill(READONLY_MEMBER.password);
      await memberPage.getByRole("button", { name: "Create Account" }).click();
      await memberPage.waitForURL((url) => url.pathname === "/", {
        timeout: 30_000,
      });
      await expect(
        memberPage.getByRole("button", { name: READONLY_MEMBER.name }),
      ).toBeVisible({ timeout: 30_000 });

      // The member reaches the map (map read is a default rule) and sees the
      // system nodes created by the previous test.
      await memberPage.goto("/dependency/map");
      await expect(
        memberPage.getByRole("heading", { name: "Dependency Map" }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(memberPage.getByText(SOURCE_SYSTEM)).toBeVisible({
        timeout: 30_000,
      });
      await expect(memberPage.getByText(TARGET_SYSTEM)).toBeVisible();

      // THE regression assertion: at least one edge element is rendered. The
      // member manages no system at all, so before the fix React Flow created
      // ZERO edge elements here (every source handle was missing) — including
      // the edge between our two namespaced systems, which is guaranteed to
      // exist from the previous serial test. Attachment is the signal (see the
      // admin sanity assertion above for why not `toBeVisible`).
      await expect(
        memberPage.locator(".react-flow__edge").first(),
      ).toBeAttached({ timeout: 30_000 });
    } finally {
      await memberContext.close();
    }
  });
});
