import { test, expect } from "@checkstack/test-utils-frontend/playwright";
import type { Page } from "@playwright/test";

/**
 * Authenticated E2E for the Incidents area.
 *
 * Boot-once variant: the backend boots and the DB is reset ONCE, then specs run
 * in PARALLEL against that single shared, non-empty DB. This file is fully
 * data-isolated: every entity it creates (its prerequisite catalog system, the
 * incident title and description) is namespaced with a unique-per-run suffix
 * (`NS`) so parallel specs never collide, and no test asserts on global table
 * state (no empty-state, no global counts). Tests within this file still run
 * serially because they form one create -> resolve chain, seeding their own
 * prerequisites (a catalog system) through the UI before exercising incidents:
 *
 * - creating an incident without a system selected is validated
 * - create a system, then create an incident against it
 * - open the incident detail page via the system history
 * - change status to resolved and see it reflected in the UI
 * - resolved incident hidden by default, shown via "Show resolved" (scoped to
 *   OUR namespaced incident only)
 *
 * Selectors are derived from the real component source (IncidentConfigPage,
 * IncidentEditor, IncidentDetailPage, SystemIncidentHistoryPage, CatalogConfigPage,
 * SystemEditor) - no invented strings.
 */
test.describe.configure({ mode: "serial" });

// Unique per run so parallel specs sharing one DB never collide on names.
const NS = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
const SYSTEM_NAME = `Incident E2E System-${NS}`;
const INCIDENT_TITLE = `Checkout outage-${NS}`;
const INCIDENT_DESCRIPTION = `Users cannot complete checkout (-${NS}).`;

const NAV_TIMEOUT = 30_000;

/**
 * The catalog browse view groups systems into collapsible sections (incl. a
 * synthetic "Ungrouped" one). When a health source reports every member
 * healthy the section collapses, unmounting its row links. Expand every
 * collapsed section so the system row link becomes available. Each section
 * header is a `<button aria-expanded>` whose accessible name ends with the
 * member count ("… 1 system" / "… N systems"). Mirrors catalog.spec.ts.
 */
async function expandBrowseSections(page: Page): Promise<void> {
  const main = page.getByRole("main");
  const headers = main.getByRole("button", { name: /\d+ systems?$/ });
  await expect(headers.first()).toBeVisible({ timeout: NAV_TIMEOUT });

  // The health rollup applies asynchronously and collapses all-healthy sections;
  // wait for it to settle (its badge shows) so we expand into a stable state,
  // then open each collapsed section exactly once - awaiting the toggle before
  // moving on, so a re-click never double-toggles it shut.
  await expect(
    main.getByText(/All healthy|degraded|unhealthy/).first(),
  ).toBeVisible({ timeout: NAV_TIMEOUT });

  const count = await headers.count();
  for (let i = 0; i < count; i++) {
    const header = headers.nth(i);
    if ((await header.getAttribute("aria-expanded")) === "false") {
      await header.click();
      await expect(header).toHaveAttribute("aria-expanded", "true");
    }
  }
}

/**
 * Resolve the incident-history URL for the seeded system without clicking the
 * catalog browse rows: that view re-renders continuously from the background
 * health slot, detaching freshly-mounted links mid-click. Reading the row's
 * detail href (a stable attribute read) and navigating to it is robust, then
 * the system detail page's incident panel links to history.
 */
async function gotoSystemIncidentHistory(page: Page): Promise<void> {
  await page.goto("/catalog/", { timeout: NAV_TIMEOUT });
  await expandBrowseSections(page);

  const detailLink = page.getByRole("link", { name: SYSTEM_NAME });
  await expect(detailLink).toBeVisible({ timeout: NAV_TIMEOUT });
  const href = await detailLink.getAttribute("href");
  expect(href).toMatch(/^\/catalog\/system\//);
  await page.goto(href ?? "", { timeout: NAV_TIMEOUT });

  await expect(
    page.getByRole("heading", { name: SYSTEM_NAME }),
  ).toBeVisible({ timeout: NAV_TIMEOUT });

  // The incident panel on the system detail page links to history ("View" when
  // there are active incidents, "History" once none remain). Read the link's
  // href and navigate, avoiding the panel's live re-render churn.
  const historyLink = page
    .getByRole("link", { name: /^(View|History)$/ })
    .first();
  await expect(historyLink).toBeVisible({ timeout: NAV_TIMEOUT });
  const historyHref = await historyLink.getAttribute("href");
  expect(historyHref).toMatch(/\/incident\/system\/.+\/incidents/);
  await page.goto(historyHref ?? "", { timeout: NAV_TIMEOUT });

  await expect(
    page.getByRole("heading", { name: /Incident History/ }),
  ).toBeVisible({ timeout: NAV_TIMEOUT });
}

test.describe("incidents", () => {
  test("validates that an incident requires at least one system", async ({
    page,
  }) => {
    await page.goto("/incident/config", { timeout: NAV_TIMEOUT });

    await page.getByRole("button", { name: "Report Incident", exact: true }).click();

    // The create dialog opens.
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Create Incident" }),
    ).toBeVisible();

    // Provide a title but select NO system, then attempt to create. (We do not
    // assert the affected-systems list is empty: the shared DB may already hold
    // systems created by other parallel specs. The validation under test fires
    // purely from having zero systems *selected*, independent of how many
    // exist.)
    await dialog.getByLabel("Title").fill(`Premature incident-${NS}`);
    await dialog.getByRole("button", { name: "Create" }).click();

    // Validation now surfaces as an inline error and the dialog stays open.
    await expect(
      page.getByText("At least one system must be selected"),
    ).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "Create Incident" }),
    ).toBeVisible();

    // The form is dirty (title filled), so Cancel opens the discard-confirm
    // modal instead of closing immediately. Confirm the discard, then the
    // editor dialog closes. Scope to the discard modal (title "Discard
    // changes?", confirm button "Discard") to avoid the two-dialog strict-mode
    // ambiguity while both are mounted.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    const discard = page.getByRole("dialog", { name: "Discard changes?" });
    await expect(discard).toBeVisible();
    await discard.getByRole("button", { name: "Discard" }).click();
    await expect(
      page.getByRole("dialog", { name: "Create Incident" }),
    ).toBeHidden();
  });

  test("creates a system via the catalog so incidents can target it", async ({
    page,
  }) => {
    await page.goto("/catalog/config", { timeout: NAV_TIMEOUT });

    await expect(
      page.getByRole("heading", { name: "Catalog Management" }),
    ).toBeVisible();

    // Empty catalog → "Add your first system"; fall back to "Add System".
    const addFirst = page.getByRole("button", {
      name: "Add your first system",
    });
    const addFirstVisible = await addFirst
      .isVisible()
      .catch(() => false);
    await (addFirstVisible
      ? addFirst.click()
      : page.getByRole("button", { name: "Add System" }).click());

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Create System" }),
    ).toBeVisible();

    await dialog.getByLabel("Name").fill(SYSTEM_NAME);
    await dialog.getByRole("button", { name: "Create System" }).click();

    await expect(dialog).toBeHidden();
    // The new system appears in the management list. Scope to the desktop table:
    // the ResponsiveTable's display:none MobileCardList duplicates the name.
    await expect(page.getByRole("table").getByText(SYSTEM_NAME)).toBeVisible();
  });

  test("creates an incident against the system", async ({ page }) => {
    await page.goto("/incident/config", { timeout: NAV_TIMEOUT });

    await page.getByRole("button", { name: "Report Incident", exact: true }).click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Create Incident" }),
    ).toBeVisible();

    await dialog.getByLabel("Title").fill(INCIDENT_TITLE);
    await dialog.getByLabel("Description").fill(INCIDENT_DESCRIPTION);

    // Select the system we created (rows are clickable, labelled by name).
    await dialog.getByText(SYSTEM_NAME).click();
    await expect(dialog.getByText("1 system(s) selected")).toBeVisible();

    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(dialog).toBeHidden();

    // The incident is now in the table with an "Investigating" status badge
    // (the default status for a freshly reported incident).
    const row = page.getByRole("row", { name: new RegExp(INCIDENT_TITLE) });
    await expect(row).toBeVisible();
    await expect(row.getByText("Investigating")).toBeVisible();
  });

  test("opens the incident detail page via the system history", async ({
    page,
  }) => {
    // Browse to the system, then jump to its incident history and into the
    // incident detail page - the real user navigation path.
    await gotoSystemIncidentHistory(page);

    // Click the incident entry to open its detail page.
    await page.getByRole("link", { name: new RegExp(INCIDENT_TITLE) }).click();
    await expect(page).toHaveURL(/\/incident\/[^/]+(\?|$)/, {
      timeout: NAV_TIMEOUT,
    });

    // Detail page renders the incident as the page title and its description.
    await expect(
      page.getByRole("heading", { name: INCIDENT_TITLE }),
    ).toBeVisible();
    await expect(page.getByText(INCIDENT_DESCRIPTION)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Incident Details" }),
    ).toBeVisible();
    // The affected system is listed.
    await expect(
      page.getByText(SYSTEM_NAME, { exact: false }),
    ).toBeVisible();
  });

  test("resolves the incident from the detail page and reflects the new status", async ({
    page,
  }) => {
    // Re-derive the detail URL through the same navigation chain (each test gets
    // a fresh page, and detail URLs are id-based which we don't hardcode).
    await gotoSystemIncidentHistory(page);
    await page.getByRole("link", { name: new RegExp(INCIDENT_TITLE) }).click();

    await expect(
      page.getByRole("heading", { name: INCIDENT_TITLE }),
    ).toBeVisible();

    // The detail header exposes a Resolve action while the incident is open.
    const resolveButton = page.getByRole("button", { name: "Resolve" });
    await expect(resolveButton).toBeVisible();
    await resolveButton.click();

    // Status badge flips to "Resolved" and the Resolve button disappears.
    await expect(page.getByText("Resolved").first()).toBeVisible();
    await expect(resolveButton).toBeHidden();
  });

  test("resolved incident is hidden by default and visible via 'Show resolved'", async ({
    page,
  }) => {
    await page.goto("/incident/config", { timeout: NAV_TIMEOUT });

    await expect(
      page.getByRole("heading", { name: "Incident Management" }),
    ).toBeVisible();

    // Resolved incidents are filtered out by default. Scope to OUR namespaced
    // incident only - the shared DB may hold other parallel specs' incidents
    // (open or resolved), so we never assert a global empty state, just that
    // our resolved incident is absent from the default (open-only) list.
    const ourRow = page.getByRole("row", { name: new RegExp(INCIDENT_TITLE) });
    await expect(ourRow).toHaveCount(0);

    // Toggling "Show resolved" brings our resolved incident back into the list.
    await page.getByLabel("Show resolved").check();

    await expect(ourRow).toBeVisible();
    await expect(ourRow.getByText("Resolved")).toBeVisible();
  });
});
