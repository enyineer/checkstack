import {
  test,
  expect,
  type Locator,
  type Page,
} from "@checkstack/test-utils-frontend/playwright";

/**
 * The left tab-rail entry ("Queue"), scoped to the tab-rail nav so it never
 * collides with a same-named column-header sort button in the Queue runtime
 * data table (the "Queue" column header is now a sortable button).
 */
const infraTab = (page: Page, name: string): Locator =>
  page
    .getByRole("navigation", { name: "Infrastructure settings" })
    .getByRole("button", { name, exact: true });

/**
 * Queue admin area E2E.
 *
 * The queue has NO route of its own: `core/queue-frontend` contributes a
 * "Queue" tab into the `InfrastructureTabsSlot`, so the admin surface lives
 * inside the Infrastructure Settings shell at `/infrastructure/config`
 * (verified: `infrastructureRoutes` = `createRoutes("infrastructure", { config:
 * "/config" })`, prefixed to `/infrastructure/config`). Queue is the
 * lowest-order tab (order 10), so it is the default active tab.
 *
 * The tab stacks two sub-sections (see `QueueInfrastructureTab`):
 *  - `QueueRuntimePanel`: an observability view — instance-scope banner,
 *    aggregated count tiles, and a job-state sub-tab table.
 *  - `QueueConfigTab`: provider selection + tuning guidance.
 *
 * These tests assert only structure that is deterministic on a fresh, empty DB
 * with the default in-memory queue. They never assert volatile job counts or
 * timing. On a fresh boot the platform self-registers recurring system jobs, so
 * the Pending listing is POPULATED (not empty) while Active / Recent failed have
 * no jobs and surface their empty-states — this matches the runtime behaviour
 * the sibling `infrastructure.empty.spec.ts` already relies on.
 *
 * Empty-state variant (`*.empty.spec.ts`): the suite boots the backend ONCE and
 * runs all specs against a shared, non-empty DB in parallel. The "no active jobs
 * / no recent failures" assertions here depend on a PRISTINE runtime — other
 * specs' activity would enqueue background jobs and break them — so this file is
 * scheduled in the `empty-state` project, which runs first on a pristine DB
 * BEFORE any data spec triggers jobs. Within this file the tests still share one
 * DB, so they run serially.
 */
test.describe.configure({ mode: "serial" });

const NAV_TIMEOUT = 30_000;
const CONFIG_ROUTE = "/infrastructure/config";

test.describe("Queue admin area", () => {
  test("opens the Queue runtime panel from the infrastructure shell", async ({
    page,
  }) => {
    await page.goto(CONFIG_ROUTE, { waitUntil: "domcontentloaded" });

    // The shell mounted (PageHeader renders the title as a heading).
    await expect(
      page.getByRole("heading", { name: "Infrastructure Settings" }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });

    // Queue is the default active tab, but click it explicitly so this test
    // does not depend on tab-ordering staying at order 10. The left-nav entry
    // is a plain button whose accessible name is exactly "Queue" (label +
    // icon); `exact` keeps it from matching "Queue Runtime"/"Queue
    // Configuration" headings under substring rules.
    await infraTab(page, "Queue").click();

    // Runtime panel header (CardTitle -> <h3>).
    await expect(
      page.getByRole("heading", { name: "Queue Runtime" }),
    ).toBeVisible();
    // Its description is static copy that pins the live-refresh contract.
    await expect(
      page.getByText("Live aggregated job counts.", { exact: false }),
    ).toBeVisible();

    // The stats load must succeed, not show the error fallback.
    await expect(
      page.getByText("Failed to load queue stats."),
    ).toHaveCount(0);
  });

  test("the runtime panel shows the instance-scope banner and count tiles", async ({
    page,
  }) => {
    await page.goto(CONFIG_ROUTE, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Infrastructure Settings" }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });
    await infraTab(page, "Queue").click();
    await expect(
      page.getByRole("heading", { name: "Queue Runtime" }),
    ).toBeVisible();

    // The default in-memory queue reports an "instance" scope, so the
    // InstanceScopeBanner renders (it returns null only for "cluster"). Its
    // title is an <h6> heading naming the subject.
    await expect(
      page.getByRole("heading", { name: "Queue: instance-local metrics" }),
    ).toBeVisible();

    // Aggregated count tiles (CountTile labels). "Processing", "Completed" and
    // "Failed" are unique to the tiles; use { exact: true } because getByText is
    // a case-insensitive substring match. "Pending" also names a job sub-tab, so
    // it is asserted via the tab role in the sub-tab test instead.
    await expect(page.getByText("Processing", { exact: true })).toBeVisible();
    await expect(page.getByText("Completed", { exact: true })).toBeVisible();
    await expect(page.getByText("Failed", { exact: true })).toBeVisible();
  });

  test("the job-state sub-tabs render their listings", async ({ page }) => {
    await page.goto(CONFIG_ROUTE, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Infrastructure Settings" }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });
    await infraTab(page, "Queue").click();
    await expect(
      page.getByRole("heading", { name: "Queue Runtime" }),
    ).toBeVisible();

    // Pending is the default sub-tab. The platform self-registers recurring
    // system jobs on boot, so this listing is populated: the ResponsiveTable
    // chrome renders. Scope column-header assertions to the table roles —
    // the ResponsiveTable also emits a display:none MobileCardList that would
    // duplicate row text and trip strict mode for an unscoped getByText. "Queue"
    // is also the tab label, so { exact: true } disambiguates the columnheader.
    await page.getByRole("tab", { name: "Pending" }).click();
    await expect(
      page.getByRole("columnheader", { name: "Job ID" }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Queue", exact: true }),
    ).toBeVisible();

    // Active and Recent failed have no jobs on a fresh boot, so they surface the
    // "No <state> jobs." informational empty-state.
    await page.getByRole("tab", { name: "Active" }).click();
    await expect(page.getByText("No active jobs.")).toBeVisible();

    await page.getByRole("tab", { name: "Recent failed" }).click();
    await expect(page.getByText("No failed jobs.")).toBeVisible();

    // Recent completed may or may not have rows depending on boot timing; only
    // assert it is selectable and does not show the error fallback.
    await page.getByRole("tab", { name: "Recent completed" }).click();
    await expect(page.getByText("Failed to load jobs.")).toHaveCount(0);
  });

  test("the Queue tab also exposes the configuration sub-section", async ({
    page,
  }) => {
    await page.goto(CONFIG_ROUTE, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Infrastructure Settings" }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });
    await infraTab(page, "Queue").click();

    // The Configuration sub-section is stacked below the runtime panel inside
    // the same Queue tab.
    await expect(
      page.getByRole("heading", { name: "Queue Configuration" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save Configuration" }),
    ).toBeVisible();

    // The static performance-tuning guidance card is always present.
    await expect(
      page.getByRole("heading", { name: "Performance Tuning" }),
    ).toBeVisible();
  });
});
