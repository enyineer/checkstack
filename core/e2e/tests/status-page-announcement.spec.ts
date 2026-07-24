import { test, expect } from "@checkstack/test-utils-frontend/playwright";
import { seedPublishedStatusPage } from "./support/status-page-seed";

/**
 * Item #2 (reported by @stuajnht): the Announcements block rendered NOTHING on a
 * public status page. Root cause: the lean public bundle (used for BOTH a custom
 * domain and the same-origin `/statuspage/view/:slug` path) loads no plugins, and
 * the announcement renderer lives in a CORE plugin that was never built or served
 * as a Module Federation remote - so the block stayed blank. The fix ships
 * `@checkstack/announcement-frontend` as a public remote (`checkstack.publicRemote`)
 * that the public bundle `loadRemote`s on demand.
 *
 * This spec is the regression guard: it drives the REAL public bundle (the same
 * lean `PublicApp` a custom domain uses) via `/statuspage/view/:slug`, so a green
 * run means the remote actually built, was served, loaded over Module Federation,
 * and rendered. A logic test could not catch the remote-loading failure that
 * shipped; only rendering the public bundle can.
 *
 * The announcement is created through the real UI; the published page is seeded
 * through the real oRPC API (see `support/status-page-seed.ts` for why the
 * builder UI is not driven here). Boot-once, data-isolated: every entity is
 * namespaced (`NS`); no assertion touches global/whole-DB state (the widget shows
 * ALL public announcements, so other parallel specs' may also appear - we only
 * ever assert OUR namespaced one is present).
 */
test.describe.configure({ mode: "serial" });

const NS = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
const ANNOUNCEMENT_TITLE = `Public remote announcement-${NS}`;
const LINK_TEXT = `status details-${NS}`;
// Markdown link + bold, to ALSO prove the renderer renders sanitized markdown
// (not the raw source) on the public page.
const ANNOUNCEMENT_MESSAGE = `See the [${LINK_TEXT}](https://example.com) for **full** info.`;
const PAGE_TITLE = `Announce Status-${NS}`;
const PAGE_SLUG = `announce-${NS}`;

const NAV_TIMEOUT = 30_000;

test.describe("status page - announcement block renders on the public bundle (#2)", () => {
  test("create a public announcement", async ({ page }) => {
    await page.goto("/announcement/manage", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Announcement Management" }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });

    await page.getByRole("button", { name: "New Announcement" }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Create Announcement" }),
    ).toBeVisible();

    await dialog.getByLabel("Title").fill(ANNOUNCEMENT_TITLE);
    await dialog.getByLabel("Message (Markdown)").fill(ANNOUNCEMENT_MESSAGE);
    // Visibility defaults to "Everyone" (all) and active defaults to true, which
    // is exactly what the public status-page widget surfaces - no need to touch.
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("cell", { name: ANNOUNCEMENT_TITLE }),
    ).toBeVisible();
  });

  test("publish a page carrying the Announcements widget", async ({ page }) => {
    await seedPublishedStatusPage({
      request: page.request,
      title: PAGE_TITLE,
      slug: PAGE_SLUG,
      blocks: [{ id: "ann-block", type: "announcement.announcements", config: {} }],
    });
  });

  test("the public page renders the announcement via the loaded remote, with markdown", async ({
    page,
  }) => {
    await page.goto(`/statuspage/view/${PAGE_SLUG}`, {
      waitUntil: "domcontentloaded",
    });

    // The announcement TITLE renders - proof the remote loaded and registered its
    // renderer (the lean bundle ships no announcement code itself). Scoped to OUR
    // namespaced announcement, so a shared DB never affects the assertion.
    await expect(
      page.getByRole("heading", { name: ANNOUNCEMENT_TITLE }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });

    // #4-adjacent: the message markdown is RENDERED (a real link + bold), not the
    // raw `[text](url)` / `**` source.
    const link = page.getByRole("link", { name: LINK_TEXT });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "https://example.com");
    // If markdown were shown raw, the literal source (with brackets) would be
    // present instead of a rendered link; assert the raw form is absent.
    await expect(page.getByText(`[${LINK_TEXT}]`)).toHaveCount(0);

    // The public page is standalone: no admin chrome leaks in.
    await expect(page.getByRole("navigation")).toHaveCount(0);
  });
});
