import { test, expect } from "@checkstack/test-utils-frontend/playwright";
import type { Page } from "@playwright/test";

/**
 * Systems & Catalog E2E. Drives the real authenticated app (admin session via
 * storageState) against a shared, non-empty database.
 *
 * Boot-once variant: the backend boots and the DB is reset ONCE, then all specs
 * run in PARALLEL against that single shared DB. The DB is therefore non-empty
 * and shared, so this file is fully data-isolated: every entity it creates is
 * namespaced with a unique-per-run suffix (`NS`) so parallel specs never
 * collide, and no test asserts on global table state (no empty-state, no global
 * counts - every assertion is scoped to this file's own namespaced data). Tests
 * within this file still run serially (the create -> edit -> delete chain).
 *
 * Routes (plugin-prefixed): /catalog/ (browse), /catalog/config (manage),
 * /catalog/system/:systemId (detail).
 */
test.describe.configure({ mode: "serial" });

// Unique per run so parallel specs sharing one DB never collide. Only the
// numeric/hex suffix is appended so any slug derived from a name stays
// URL-safe (no spaces in the suffix).
const NS = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
const SYSTEM_NAME = `Payments API ${NS}`;
const SYSTEM_DESCRIPTION = `Handles all customer payment processing -${NS}`;
const SYSTEM_NAME_UPDATED = `Payments Gateway ${NS}`;
const GROUP_NAME = `Payment Flow ${NS}`;

const NAV_TIMEOUT = 30_000;

/**
 * Browse groups systems into collapsible sections (including a synthetic
 * "Ungrouped" section). When a health source reports every member healthy the
 * section starts COLLAPSED, so its system rows are unmounted and the row links
 * are absent from the DOM. Expand every currently-collapsed section so the row
 * links become visible/clickable. Each section header is a
 * `<button aria-expanded>`; clicking a collapsed one opens it. We loop because
 * expanding one can reflow the set of remaining collapsed buttons.
 */
async function expandBrowseSections(page: Page): Promise<void> {
  // Scope to the page main and to section headers only: their accessible name
  // ends with the member count ("… 1 system" / "… N systems"), which the
  // navbar/menu disclosure buttons never carry.
  const main = page.getByRole("main");
  const headers = main.getByRole("button", { name: /\d+ systems?$/ });
  await expect(headers.first()).toBeVisible();

  // The health rollup applies ASYNCHRONOUSLY: sections render expanded, then an
  // all-healthy section collapses once the slot reports its rollup. We can't
  // wait on the rollup badge to know it settled: a system with no health data
  // reads "unknown" now and renders NO rollup pill at all. Instead, poll - open
  // every still-collapsed section until none remain collapsed. A manual open
  // stores an explicit override that wins over the all-healthy auto-collapse, so
  // each opened section sticks; a section the async rollup collapses later is
  // re-opened on the next iteration, and the settle assertion catches it.
  const collapsed = main.getByRole("button", {
    name: /\d+ systems?$/,
    expanded: false,
  });
  await expect(async () => {
    while ((await collapsed.count()) > 0) {
      await collapsed.first().click();
    }
    await expect(collapsed).toHaveCount(0);
  }).toPass({ timeout: NAV_TIMEOUT });
}

test.describe("Systems & Catalog", () => {
  test("creating a system requires a name", async ({ page }) => {
    await page.goto("/catalog/config", { timeout: NAV_TIMEOUT });

    await page.getByRole("button", { name: "Add System" }).click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Create System" }),
    ).toBeVisible();

    // With an empty name the submit button is disabled — the form can't be
    // submitted until a name is provided.
    const submit = dialog.getByRole("button", { name: "Create System" });
    await expect(submit).toBeDisabled();

    // Filling only the description keeps the submit disabled (name required).
    await dialog
      .getByPlaceholder("Describe what this system does...")
      .fill(SYSTEM_DESCRIPTION);
    await expect(submit).toBeDisabled();

    // Typing a name enables submission.
    await dialog.getByLabel("Name").fill(SYSTEM_NAME);
    await expect(submit).toBeEnabled();

    // Close without saving so the next test owns the create.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("creating a system adds it to management and browse", async ({
    page,
  }) => {
    await page.goto("/catalog/config", { timeout: NAV_TIMEOUT });

    await page.getByRole("button", { name: "Add System" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill(SYSTEM_NAME);
    await dialog
      .getByPlaceholder("Describe what this system does...")
      .fill(SYSTEM_DESCRIPTION);
    await dialog.getByRole("button", { name: "Create System" }).click();

    // The dialog closes on success.
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // The new system appears in the management systems list. Scope to the
    // desktop `<table>`: the ResponsiveTable also renders a display:none
    // MobileCardList with the same name/description, so an unscoped getByText
    // would match both DOM nodes and trip Playwright strict mode.
    const managementTable = page.getByRole("table");
    await expect(managementTable.getByText(SYSTEM_NAME)).toBeVisible();
    await expect(managementTable.getByText(SYSTEM_DESCRIPTION)).toBeVisible();

    // ...and in the public browse view. The system lives inside a
    // (default-collapsed, all-healthy) section, so expand it to reveal the row
    // link. The shared DB may hold other specs' systems, so we assert only that
    // OUR namespaced row link is browsable - never a global empty/count state.
    await page.goto("/catalog/", { timeout: NAV_TIMEOUT });
    await expandBrowseSections(page);
    await expect(
      page.getByRole("link", { name: SYSTEM_NAME }),
    ).toBeVisible();
  });

  // Regression guard: the catalog backend now rejects duplicate system names
  // (createSystem in core/catalog-backend/src/router.ts throws CONFLICT via
  // entityService.getSystemByName). A second create with an existing name must
  // be refused with an error and must not add a second row.
  test("rejects a duplicate system name", async ({ page }) => {
    await page.goto("/catalog/config", { timeout: NAV_TIMEOUT });

    // The first system must already be present from the previous test. Scope to
    // the desktop `<table>`: the ResponsiveTable's display:none MobileCardList
    // holds a duplicate of the name, which would otherwise trip strict mode.
    const managementTable = page.getByRole("table");
    await expect(managementTable.getByText(SYSTEM_NAME)).toBeVisible();

    await page.getByRole("button", { name: "Add System" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill(SYSTEM_NAME);
    await dialog
      .getByPlaceholder("Describe what this system does...")
      .fill(`Second system, same name -${NS}`);
    await dialog.getByRole("button", { name: "Create System" }).click();

    // The backend rejects the duplicate (CONFLICT) and the reason is surfaced to
    // the user as an error toast.
    await expect(
      page.getByText(/already exists/i),
    ).toBeVisible({ timeout: 8000 });

    // The create dialog stays OPEN on error (so the user can fix the name).
    // While it is open the modal aria-hides the page behind it, so the table is
    // not reachable by role; dismiss it first, then assert no second row exists.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // No second row was added - exactly one system carries THIS namespaced name
    // (counted in the desktop table, which renders one node per system). Scoped
    // to our own name only, so it holds regardless of other specs' rows.
    await expect(managementTable.getByText(SYSTEM_NAME)).toHaveCount(1);
  });

  test("opens the system detail page from browse", async ({ page }) => {
    await page.goto("/catalog/", { timeout: NAV_TIMEOUT });

    // Reveal the (default-collapsed, all-healthy) section holding the system,
    // then CLICK the row. This is the regression guard for the browse
    // re-render/remount loop: previously the health slot re-reported on every
    // render, remounting rows continuously so a click hit a detached element
    // ("element is not stable"). With the consumer-side equality guard the row
    // is stable and the click navigates cleanly.
    await expandBrowseSections(page);
    const detailLink = page.getByRole("link", { name: SYSTEM_NAME });
    await expect(detailLink).toBeVisible();
    await expect(detailLink).toHaveAttribute("href", /^\/catalog\/system\//);
    await detailLink.click();
    await expect(page).toHaveURL(/\/catalog\/system\//, {
      timeout: NAV_TIMEOUT,
    });

    // PageLayout renders the system name as the page heading.
    await expect(
      page.getByRole("heading", { name: SYSTEM_NAME }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(page).toHaveURL(/\/catalog\/system\//);

    // The "About" context panel renders the description. Target the panel
    // heading by role: a plain getByText("About") also substring-matches the
    // AI-memory panel prose ("...saved about this system").
    await expect(
      page.getByRole("heading", { name: "About" }),
    ).toBeVisible();
    await expect(page.getByText(SYSTEM_DESCRIPTION)).toBeVisible();
  });

  test("edits a system name", async ({ page }) => {
    await page.goto("/catalog/config", { timeout: NAV_TIMEOUT });

    // Each system row exposes an aria-labelled edit button.
    await page
      .getByRole("button", { name: `Edit ${SYSTEM_NAME}` })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Edit System" }),
    ).toBeVisible();

    const nameField = dialog.getByLabel("Name");
    await expect(nameField).toHaveValue(SYSTEM_NAME);
    await nameField.fill(SYSTEM_NAME_UPDATED);
    await dialog.getByRole("button", { name: "Save Changes" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Scope to the desktop table: the ResponsiveTable's display:none
    // MobileCardList renders the same name, which would trip strict mode.
    // Longer timeout: under parallel load the list refetch after Save can take
    // a beat longer than the default expect timeout.
    await expect(
      page.getByRole("table").getByText(SYSTEM_NAME_UPDATED),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("creates a group and views it", async ({ page }) => {
    await page.goto("/catalog/config", { timeout: NAV_TIMEOUT });

    await page.getByRole("tab", { name: "Groups" }).click();
    await page.getByRole("button", { name: "Add Group" }).click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Create Group" }),
    ).toBeVisible();

    // The group name is required: submit is disabled until it's filled.
    const submit = dialog.getByRole("button", { name: "Create Group" });
    await expect(submit).toBeDisabled();
    await dialog.getByLabel("Name").fill(GROUP_NAME);
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Our new group is listed. Scope the name to the desktop table (the
    // MobileCardList duplicates it in the DOM) and to our namespaced name only -
    // the shared DB may hold other groups, so we never assert global state.
    await expect(page.getByRole("table").getByText(GROUP_NAME)).toBeVisible();
  });

  test("assigns a system to a group via the Groups-tab picker", async ({
    page,
  }) => {
    // Guards the regression where the assign popover, rendered inside the table's
    // overflow-auto wrapper, was clipped and unclickable. The picker is portaled
    // now, so the option is clickable and the chip lands.
    await page.goto("/catalog/config", { timeout: NAV_TIMEOUT });
    await page.getByRole("tab", { name: "Groups" }).click();

    await page
      .getByRole("button", { name: `Add a system to ${GROUP_NAME}` })
      .click();
    // The portaled option (the renamed system from the earlier edit test).
    await page.getByRole("button", { name: SYSTEM_NAME_UPDATED }).click();

    // The system now appears as a removable member chip on the group row.
    await expect(
      page.getByRole("button", {
        name: `Remove ${SYSTEM_NAME_UPDATED} from ${GROUP_NAME}`,
      }),
    ).toBeVisible();
  });

  test("creates an environment and attaches a system to it", async ({
    page,
  }) => {
    const ENV_NAME = `Production ${NS}`;
    await page.goto("/catalog/config", { timeout: NAV_TIMEOUT });

    // Create an environment on the Environments tab.
    await page.getByRole("tab", { name: "Environments" }).click();
    await page.getByRole("button", { name: "Add Environment" }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Create Environment" }),
    ).toBeVisible();
    await dialog.getByLabel("Name").fill(ENV_NAME);
    await dialog.getByRole("button", { name: "Create Environment" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Scope to the desktop table (the MobileCardList duplicates the name).
    await expect(page.getByRole("table").getByText(ENV_NAME)).toBeVisible();

    // Attach the system to it from the Systems tab's Environment picker.
    await page.getByRole("tab", { name: "Systems" }).click();
    await page
      .getByRole("button", {
        name: `Attach ${SYSTEM_NAME_UPDATED} to an environment`,
      })
      .click();
    await page.getByRole("button", { name: ENV_NAME }).click();

    // The environment chip lands on the system row...
    await expect(
      page.getByRole("button", {
        name: `Remove ${SYSTEM_NAME_UPDATED} from ${ENV_NAME}`,
      }),
    ).toBeVisible();

    // ...and the system shows as a member on the Environments tab. Members
    // collapse into a "N systems" count pill (MembershipChips) whose names live
    // in a popover, so open the env row's pill to reveal the member name. Scope
    // to the desktop table (the MobileCardList duplicates the row).
    await page.getByRole("tab", { name: "Environments" }).click();
    const envRow = page
      .getByRole("table")
      .getByRole("row")
      .filter({ hasText: ENV_NAME });
    await envRow
      .getByRole("button", { name: /systems?, show list$/ })
      .click();
    await expect(page.getByText(SYSTEM_NAME_UPDATED)).toBeVisible();
  });

  test("filtered browse shows a no-matches state with clear-filters", async ({
    page,
  }) => {
    await page.goto("/catalog/", { timeout: NAV_TIMEOUT });

    // The system must be browsable before we filter it out (expand the
    // default-collapsed, all-healthy section to surface its row).
    await expandBrowseSections(page);
    await expect(
      page.getByRole("link", { name: SYSTEM_NAME_UPDATED }),
    ).toBeVisible();

    // Search for a namespaced string guaranteed not to match ANY system in the
    // shared DB (the `zzz-${NS}` token belongs to no entity here or elsewhere),
    // so the no-matches state is reliable regardless of other specs' data.
    await page
      .getByRole("searchbox", { name: "Search systems and groups" })
      .fill(`zzz-no-such-system-${NS}`);

    // The filtered-empty state appears with a clear-filters affordance.
    await expect(
      page.getByText("No systems match the current search and filters."),
    ).toBeVisible();
    const clear = page.getByRole("button", { name: "Clear filters" });
    await expect(clear).toBeVisible();

    // Clearing filters restores the system. The all-healthy section collapses
    // back to its default once the search auto-expand no longer applies, so
    // re-expand before asserting the row link is browsable again.
    await clear.click();
    await expect(
      page.getByText("No systems match the current search and filters."),
    ).toHaveCount(0);
    await expandBrowseSections(page);
    await expect(
      page.getByRole("link", { name: SYSTEM_NAME_UPDATED }),
    ).toBeVisible();
  });

  test("deletes a system with confirmation", async ({ page }) => {
    await page.goto("/catalog/config", { timeout: NAV_TIMEOUT });

    // Scope to the desktop table (the MobileCardList duplicates the name).
    await expect(
      page.getByRole("table").getByText(SYSTEM_NAME_UPDATED),
    ).toBeVisible();

    await page
      .getByRole("button", { name: `Delete ${SYSTEM_NAME_UPDATED}` })
      .click();

    // The confirmation modal names the system being deleted.
    const confirm = page.getByRole("dialog");
    await expect(confirm.getByText("Delete System")).toBeVisible();
    await expect(
      confirm.getByText(new RegExp(`delete .*${NS}`, "i")),
    ).toBeVisible();

    await confirm.getByRole("button", { name: "Delete" }).click();

    // OUR namespaced system is gone. Scoped to our own system only - the shared
    // DB may still hold rows created by other parallel specs, so we never assert
    // a global empty state.
    await expect(
      page.getByRole("table").getByText(SYSTEM_NAME_UPDATED),
    ).toHaveCount(0);
  });
});
