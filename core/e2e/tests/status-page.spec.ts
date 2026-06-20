import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Authenticated E2E coverage for operator-built status pages (plan §3.1).
 *
 * Routes under test:
 *   - `/status-pages`        the admin list (create + manage)
 *   - `/status-pages/:id`    the builder (add a content widget, publish)
 *   - `/status/:slug`        the PUBLIC, same-origin render path
 *
 * The journey proves the security invariant end to end (the unit layer covers it
 * in `service.test.ts`): the public surface serves ONLY a published page, and
 * shows exactly what the operator placed on it. We use the built-in CONTENT
 * widgets (Heading / Text) so the spec needs no catalog system to bind — the
 * binding-widget authz path is the unit suite's job.
 *
 * The whole file shares ONE freshly reset, empty Postgres database (only the
 * admin exists at boot), so the tests run serially and the empty-state /
 * not-published assertions are ordered before the publish ones.
 */
test.describe.configure({ mode: "serial" });

// Unique suffix so created resources never clash across reruns sharing a DB.
const RUN_ID = Date.now();
const PAGE_TITLE = `Acme Status ${RUN_ID}`;
const PAGE_SLUG = `acme-${RUN_ID}`;
const HEADING_TEXT = `All systems status ${RUN_ID}`;
const UNPUBLISHED_SLUG = `ghost-${RUN_ID}`;

test.describe("Status pages", () => {
  test("list renders its empty state when no pages exist", async ({ page }) => {
    await page.goto("/status-pages", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { name: "Status pages" }),
    ).toBeVisible({ timeout: 30_000 });
    // Empty state copy from StatusPagesListPage.
    await expect(page.getByText("No status pages yet")).toBeVisible();
    // We must not have landed on the catch-all 404.
    await expect(page.locator("body")).not.toContainText("Route not found");
  });

  test("an unpublished page is NOT served on the public route", async ({
    page,
  }) => {
    // Create a page but never publish it.
    await page.goto("/status-pages", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "New status page" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder("Acme Status").fill(`Ghost ${RUN_ID}`);
    // The slug auto-follows the title; override it to a known value.
    await dialog.getByPlaceholder("acme", { exact: true }).fill(UNPUBLISHED_SLUG);
    await dialog.getByRole("button", { name: "Create" }).click();

    // Lands on the builder for the new page.
    await expect(page).toHaveURL(/\/status-pages\/[^/]+$/, { timeout: 30_000 });

    // The public route must NOT serve an unpublished page.
    await page.goto(`/status/${UNPUBLISHED_SLUG}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByText("Status page not found")).toBeVisible({
      timeout: 30_000,
    });
  });

  test("operator builds, publishes, and the public page serves the content", async ({
    page,
  }) => {
    // 1. Create the page.
    await page.goto("/status-pages", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "New status page" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder("Acme Status").fill(PAGE_TITLE);
    await dialog.getByPlaceholder("acme", { exact: true }).fill(PAGE_SLUG);
    await dialog.getByRole("button", { name: "Create" }).click();

    // 2. In the builder, add a Heading content widget and fill its text.
    await expect(page).toHaveURL(/\/status-pages\/[^/]+$/, { timeout: 30_000 });

    // The "Add a block…" select lists the registered widget types.
    await page.getByRole("combobox", { name: /Add a block/i }).click();
    await page.getByRole("option", { name: "Heading" }).click();
    await page.getByRole("button", { name: "Add" }).click();

    // Fill the heading text (the block's inline editor input).
    await page.getByPlaceholder("Heading text").fill(HEADING_TEXT);

    // 3. Publish (saves the draft, then publishes the snapshot).
    await page.getByRole("button", { name: /^Publish$/ }).click();
    // The list badge / builder subtitle flips to "Published" on success.
    await expect(page.getByText(/Published/).first()).toBeVisible({
      timeout: 30_000,
    });

    // 4. The PUBLIC route serves the published content same-origin.
    await page.goto(`/status/${PAGE_SLUG}`, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: PAGE_TITLE }),
    ).toBeVisible({ timeout: 30_000 });
    // The Heading widget's text is rendered on the public page.
    await expect(page.getByText(HEADING_TEXT)).toBeVisible();
    // The public page is standalone: no admin chrome leaks in.
    await expect(page.getByRole("navigation")).toHaveCount(0);
  });
});
