import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Infrastructure Settings (queue / cache) E2E.
 *
 * The page at `/infrastructure/config` is a plugin-agnostic shell that renders
 * a vertical tab bar; each tab is contributed by a plugin via the
 * `InfrastructureTabsSlot` (queue → "Queue", cache → "Cache"). The admin used
 * by the harness has every access rule, so all registered tabs are visible.
 *
 * These tests assert the shell + tabs render, the Queue tab shows its runtime
 * status (counts + job sub-tabs) without crashing, tab switching works, and the
 * informational empty-state holds on a fresh DB (no jobs, in-memory queue).
 *
 * All tests share one fresh, empty DB, so run serially.
 */
test.describe.configure({ mode: "serial" });

const CONFIG_ROUTE = "/infrastructure/config";

test.describe("infrastructure settings", () => {
  test("renders the page shell with the Queue and Cache tabs", async ({
    page,
  }) => {
    await page.goto(CONFIG_ROUTE, { waitUntil: "domcontentloaded" });

    // The PageLayout title is the strongest signal the shell mounted.
    await expect(
      page.getByRole("heading", { name: "Infrastructure Settings" }),
    ).toBeVisible({ timeout: 30_000 });

    // Not the catch-all 404 and not the per-page access-denied state.
    await expect(page.locator("body")).not.toContainText("Route not found");
    await expect(page.locator("body")).not.toContainText("Access Denied");

    // Admin has all access, so every registered tab is present.
    await expect(
      page.getByRole("button", { name: "Queue" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Cache" }),
    ).toBeVisible();
  });

  test("the Queue tab shows runtime status without crashing", async ({
    page,
  }) => {
    await page.goto(CONFIG_ROUTE, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Infrastructure Settings" }),
    ).toBeVisible({ timeout: 30_000 });

    // Queue is the lowest-order tab (order 10), so it is the default active tab.
    await page.getByRole("button", { name: "Queue" }).click();

    // Runtime panel header.
    await expect(
      page.getByRole("heading", { name: "Queue Runtime" }),
    ).toBeVisible();

    // Aggregated count tiles (labels rendered by CountTile). The processor /
    // lag status surfaces here; assert it renders rather than erroring.
    // "Processing", "Completed" and "Failed" are unique to the tiles; "Pending"
    // also appears as a job sub-tab, so it is covered by the sub-tab test below.
    await expect(page.getByText("Processing", { exact: true })).toBeVisible();
    await expect(page.getByText("Completed", { exact: true })).toBeVisible();
    await expect(page.getByText("Failed", { exact: true })).toBeVisible();

    // The stats load must succeed, not show the error fallback.
    await expect(
      page.getByText("Failed to load queue stats."),
    ).toHaveCount(0);

    // The Configuration sub-section also lives in the Queue tab.
    await expect(
      page.getByRole("heading", { name: "Queue Configuration" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save Configuration" }),
    ).toBeVisible();
  });

  test("the Queue runtime job sub-tabs are present and switchable", async ({
    page,
  }) => {
    await page.goto(CONFIG_ROUTE, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Infrastructure Settings" }),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Queue" }).click();
    await expect(
      page.getByRole("heading", { name: "Queue Runtime" }),
    ).toBeVisible();

    // The runtime panel exposes a job-state Tabs control. On a fresh boot the
    // platform self-registers recurring system jobs, so the Pending listing
    // shows a populated job table (column headers + at least one row) rather
    // than an empty-state. Assert the table chrome renders without crashing.
    await page.getByRole("tab", { name: "Pending" }).click();
    await expect(
      page.getByRole("columnheader", { name: "Job ID" }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Queue", exact: true }),
    ).toBeVisible();

    // Active and Recent-failed have no jobs on a fresh boot, so they surface
    // their informational empty-state ("No <state> jobs.").
    await page.getByRole("tab", { name: "Active" }).click();
    await expect(page.getByText("No active jobs.")).toBeVisible();

    await page.getByRole("tab", { name: "Recent failed" }).click();
    await expect(page.getByText("No failed jobs.")).toBeVisible();

    // Recent-completed may or may not have rows depending on boot timing
    // (system jobs run shortly after start). Just assert the tab is selectable
    // and the panel does not show the error fallback.
    await page.getByRole("tab", { name: "Recent completed" }).click();
    await expect(page.getByText("Failed to load jobs.")).toHaveCount(0);
  });

  test("switching to the Cache tab swaps the content area", async ({
    page,
  }) => {
    await page.goto(CONFIG_ROUTE, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Infrastructure Settings" }),
    ).toBeVisible({ timeout: 30_000 });

    // Start on Queue, verify its content, then switch to Cache and verify the
    // Queue runtime content is gone (the tab body is swapped, not stacked).
    await page.getByRole("button", { name: "Queue" }).click();
    await expect(
      page.getByRole("heading", { name: "Queue Runtime" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Cache" }).click();
    await expect(
      page.getByRole("heading", { name: "Queue Runtime" }),
    ).toHaveCount(0);

    // Still on the infrastructure shell, no error / 404.
    await expect(
      page.getByRole("heading", { name: "Infrastructure Settings" }),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Route not found");
  });
});
