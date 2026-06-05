import { test, expect } from "@checkstack/test-utils-frontend/playwright";
import type { Page } from "@playwright/test";

/**
 * Authenticated E2E for the Incidents area.
 *
 * The whole file shares ONE freshly-reset, empty database (only the admin user
 * exists at start), so the suite runs serially and seeds its own prerequisites
 * (a catalog system) through the UI before exercising incidents:
 *
 * - empty incidents state (asserted before anything is created)
 * - creating an incident without a system is validated
 * - create a system, then create an incident against it
 * - open the incident detail page via the system history
 * - change status to resolved and see it reflected in the UI
 *
 * Selectors are derived from the real component source (IncidentConfigPage,
 * IncidentEditor, IncidentDetailPage, SystemIncidentHistoryPage, CatalogConfigPage,
 * SystemEditor) - no invented strings.
 */
test.describe.configure({ mode: "serial" });

// Unique suffix so re-runs / parallel files never collide on names.
const RUN_ID = Date.now();
const SYSTEM_NAME = `Incident E2E System ${RUN_ID}`;
const INCIDENT_TITLE = `Checkout outage ${RUN_ID}`;
const INCIDENT_DESCRIPTION = `Users cannot complete checkout (${RUN_ID}).`;

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
  test("shows the empty incidents state on a fresh database", async ({
    page,
  }) => {
    await page.goto("/incident/config", { timeout: NAV_TIMEOUT });

    await expect(
      page.getByRole("heading", { name: "Incident Management" }),
    ).toBeVisible();

    // Empty state from IncidentConfigPage (EmptyState renders the title as a
    // paragraph, not a heading).
    await expect(page.getByText("No incidents found")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Report incident manually" }),
    ).toBeVisible();
  });

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

    // No systems exist yet, so the affected-systems list shows the empty hint.
    await expect(dialog.getByText("No systems available")).toBeVisible();

    // Provide a title but no system, then attempt to create.
    await dialog.getByLabel("Title").fill(`Premature incident ${RUN_ID}`);
    await dialog.getByRole("button", { name: "Create" }).click();

    // Validation surfaces as a toast and the dialog stays open.
    await expect(
      page.getByText("At least one system must be selected"),
    ).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "Create Incident" }),
    ).toBeVisible();

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
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
    // The new system appears in the management list.
    await expect(page.getByText(SYSTEM_NAME)).toBeVisible();
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

    // Resolved incidents are filtered out by default → empty state returns.
    await expect(page.getByText("No incidents found")).toBeVisible();

    // Toggling "Show resolved" brings the resolved incident back into the list.
    await page.getByLabel("Show resolved").check();

    const row = page.getByRole("row", { name: new RegExp(INCIDENT_TITLE) });
    await expect(row).toBeVisible();
    await expect(row.getByText("Resolved")).toBeVisible();
  });
});
