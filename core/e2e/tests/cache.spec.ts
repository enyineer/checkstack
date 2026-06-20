import { test, expect } from "@checkstack/test-utils-frontend/playwright";
import type { Page } from "@playwright/test";

/**
 * Cache admin E2E. Drives the real authenticated app (admin session via
 * storageState) against a freshly reset, empty database.
 *
 * The cache plugin contributes NO routes of its own: it registers a "Cache"
 * tab into the Infrastructure Settings page (`InfrastructureTabsSlot`), served
 * at `/infrastructure/config`. The page renders a left vertical nav of tab
 * buttons; "Cache" has `order: 20`, so it is not the default-selected tab and
 * must be clicked to reveal its body.
 *
 * The Cache tab stacks two sections: a read-only Runtime panel (live stats +
 * a key listing) and a Configuration panel (provider selection). On a fresh
 * install the active provider is the in-memory cache, which is instance-scoped,
 * so the instance-scope banner and the in-memory warning are both present.
 *
 * These tests cover only deterministic structure (headings, always-present
 * controls, empty/idle states). They do NOT assert volatile metric values.
 * The plugin exposes no clear/flush/purge control, so none is exercised.
 */
test.describe.configure({ mode: "serial" });

const NAV_TIMEOUT = 30_000;

/**
 * Open the Infrastructure Settings page and activate the Cache tab. The tab
 * bar is a column of plain `<button>`s labelled by the contributing plugin;
 * "Cache" is contributed by the cache plugin.
 */
async function gotoCacheTab(page: Page): Promise<void> {
  await page.goto("/infrastructure/config", { timeout: NAV_TIMEOUT });
  await expect(
    page.getByRole("heading", { name: "Infrastructure Settings" }),
  ).toBeVisible({ timeout: NAV_TIMEOUT });
  await page.getByRole("button", { name: "Cache", exact: true }).click();
}

test.describe("Cache admin", () => {
  test("Infrastructure page exposes the Cache tab", async ({ page }) => {
    await page.goto("/infrastructure/config", { timeout: NAV_TIMEOUT });

    // PageLayout renders the shell heading.
    await expect(
      page.getByRole("heading", { name: "Infrastructure Settings" }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });

    // The cache plugin contributes a left-nav tab button labelled "Cache".
    await expect(
      page.getByRole("button", { name: "Cache", exact: true }),
    ).toBeVisible();
  });

  test("Cache tab renders the runtime panel with stat tiles", async ({
    page,
  }) => {
    await gotoCacheTab(page);

    // The Runtime card heading.
    await expect(
      page.getByRole("heading", { name: "Cache Runtime" }),
    ).toBeVisible();

    // The four always-present stat tiles (labels are static; their values are
    // volatile and intentionally not asserted).
    await expect(page.getByText("Keys", { exact: true })).toBeVisible();
    await expect(page.getByText("Memory", { exact: true })).toBeVisible();
    await expect(page.getByText("Hits", { exact: true })).toBeVisible();
    await expect(page.getByText("Hit rate", { exact: true })).toBeVisible();

    // The default in-memory backend is instance-scoped, so the scope banner
    // for the Cache subject is shown.
    await expect(
      page.getByText("Cache: instance-local metrics", { exact: true }),
    ).toBeVisible();
  });

  test("Cache runtime offers Biggest/Newest entry views with an idle state", async ({
    page,
  }) => {
    await gotoCacheTab(page);

    // The entry listing exposes two sort sub-tabs. "Biggest" is the default
    // (the panel seeds sortBy to "biggest").
    const biggestTab = page.getByRole("tab", { name: "Biggest" });
    const newestTab = page.getByRole("tab", { name: "Newest" });
    await expect(biggestTab).toBeVisible();
    await expect(newestTab).toBeVisible();

    // The listing settles into a deterministic state: either real entries (a
    // Key/Size/TTL table - the cache is usually already warm from boot-time
    // activity) or an idle note (empty, or an unsupported-listing backend).
    // Accept either so the test does not depend on cache population timing.
    const idle = page.getByText(/No cache entries\.|Listing not supported/);
    const entriesHeader = page.getByRole("columnheader", { name: "Key" });
    await expect(idle.or(entriesHeader).first()).toBeVisible({
      timeout: NAV_TIMEOUT,
    });

    // Switching to "Newest" keeps the listing in a stable, renderable state.
    await newestTab.click();
    await expect(idle.or(entriesHeader).first()).toBeVisible({
      timeout: NAV_TIMEOUT,
    });
  });

  test("Cache tab exposes the configuration panel with a save control", async ({
    page,
  }) => {
    await gotoCacheTab(page);

    // The Configuration card heading and its static info card.
    await expect(
      page.getByRole("heading", { name: "Cache Configuration" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Cache Usage" }),
    ).toBeVisible();

    // The default in-memory backend surfaces its warning alert.
    await expect(
      page.getByText("In-Memory Cache Warning", { exact: true }),
    ).toBeVisible();

    // The always-present save control. Admin has manage access, so it is
    // enabled (label is "Save Configuration" when idle).
    const save = page.getByRole("button", { name: "Save Configuration" });
    await expect(save).toBeVisible();
    await expect(save).toBeEnabled();
  });
});
