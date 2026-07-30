import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Authenticated E2E coverage for operator-built status pages (plan §3.1).
 *
 * Routes under test:
 *   - `/statuspage`        the admin list (create + manage)
 *   - `/statuspage/:id`    the builder (add a content widget, publish)
 *   - `/statuspage/view/:slug`        the PUBLIC, same-origin render path
 *
 * The journey proves the security invariant end to end (the unit layer covers it
 * in `service.test.ts`): the public surface serves ONLY a published page, and
 * shows exactly what the operator placed on it. We use the built-in CONTENT
 * widgets (Heading / Text) so the spec needs no catalog system to bind — the
 * binding-widget authz path is the unit suite's job.
 *
 * Boot-once variant: the backend boots and the DB is reset ONCE, then all
 * boot-once specs run in PARALLEL against that single shared DB. The DB is
 * therefore non-empty and shared, so this file is fully data-isolated: every
 * page (title, slug, heading text) it creates is namespaced with a unique
 * per-run suffix (`NS`) so parallel specs never collide, and no test asserts on
 * global table state (no empty-state, no global counts). Tests within this file
 * still run serially (the create -> publish -> delete chain), but every
 * assertion is scoped to THIS run's namespaced page.
 */
test.describe.configure({ mode: "serial" });

// Unique per run so parallel specs sharing one DB never collide. Suffix is only
// numeric/hex so it stays URL-safe when embedded in a slug.
const NS = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
const PAGE_TITLE = `Acme Status-${NS}`;
const PAGE_SLUG = `acme-${NS}`;
const HEADING_TEXT = `All systems status-${NS}`;
const UNPUBLISHED_TITLE = `Ghost-${NS}`;
const UNPUBLISHED_SLUG = `ghost-${NS}`;

test.describe("Status pages", () => {
  test("an unpublished page is NOT served on the public route", async ({
    page,
  }) => {
    // Create a page but never publish it.
    await page.goto("/statuspage", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Status pages" }),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "New status page" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder("Acme Status").fill(UNPUBLISHED_TITLE);
    // The slug auto-follows the title; override it to a known value.
    await dialog.getByPlaceholder("acme", { exact: true }).fill(UNPUBLISHED_SLUG);
    await dialog.getByRole("button", { name: "Create" }).click();

    // Lands on the builder for the new page.
    await expect(page).toHaveURL(/\/statuspage\/[^/]+$/, { timeout: 30_000 });

    // The public route must NOT serve an unpublished page. This assertion is
    // specific to our namespaced slug, so it stays correct on a shared DB.
    await page.goto(`/statuspage/view/${UNPUBLISHED_SLUG}`, {
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
    await page.goto("/statuspage", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "New status page" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder("Acme Status").fill(PAGE_TITLE);
    await dialog.getByPlaceholder("acme", { exact: true }).fill(PAGE_SLUG);
    await dialog.getByRole("button", { name: "Create" }).click();

    // 2. In the builder, add a Heading content widget and fill its text.
    await expect(page).toHaveURL(/\/statuspage\/[^/]+$/, { timeout: 30_000 });

    // The "Add a block…" select lists the registered widget types. The "Add"
    // button is `disabled={!addType}`, so it only becomes clickable once the
    // selection has actually landed.
    //
    // Retry the whole open-and-pick: clicking an option while the select is
    // still running its open animation can land before the item is
    // interactive, leaving `addType` unset - and the symptom is then a
    // confusing 30s timeout on the "Add" BUTTON rather than on the select.
    // Asserting the trigger reflects the choice makes the failure land where
    // the cause is.
    const blockSelect = page.getByRole("combobox", { name: /Add a block/i });
    const headingOption = page.getByRole("option", { name: "Heading" });
    await expect(async () => {
      // Only open the popover if it is not ALREADY open: the builder's
      // live-preview re-render intermittently leaves it open (see
      // `support/status-page-seed.ts`, which avoids this control entirely for
      // that reason), and blindly clicking the trigger would toggle it shut and
      // oscillate on every retry.
      if (!(await headingOption.isVisible().catch(() => false))) {
        await blockSelect.click();
      }
      await headingOption.click();
      // Bounded on purpose: this runs inside a `toPass` retry loop, so it must
      // fail fast enough for the loop to retry - the global expect timeout
      // would burn most of the budget on one attempt. But not too tight
      // either: at 3s every attempt failed to even find the trigger on a
      // loaded machine. ~10s per attempt over 60s gives roughly six real
      // tries, which is what this oscillating popover needs.
      await expect(blockSelect).toContainText("Heading", { timeout: 10_000 });
    }).toPass({ timeout: 60_000 });

    const addBlockButton = page.getByRole("button", { name: "Add" });
    await expect(addBlockButton).toBeEnabled();
    await addBlockButton.click();

    // Fill the heading text (the block's inline editor input).
    await page.getByPlaceholder("Heading text").fill(HEADING_TEXT);

    // 3. Publish (saves the draft, then publishes the snapshot).
    await page.getByRole("button", { name: /^Publish$/ }).click();
    // The list badge / builder subtitle flips to "Published" on success.
    await expect(page.getByText(/Published/).first()).toBeVisible({
      timeout: 30_000,
    });

    // 4. The PUBLIC route serves the published content same-origin. Scoped to
    // our namespaced slug + title so a shared DB doesn't affect the assertion.
    await page.goto(`/statuspage/view/${PAGE_SLUG}`, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: PAGE_TITLE }),
    ).toBeVisible({ timeout: 30_000 });
    // The Heading widget's text is rendered on the public page.
    await expect(page.getByText(HEADING_TEXT)).toBeVisible();
    // The public page is standalone: no admin chrome leaks in.
    await expect(page.getByRole("navigation")).toHaveCount(0);
  });
});
