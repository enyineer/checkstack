import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Dashboard (overview landing + tips banner).
 *
 * The dashboard is the landing route ("/"): `core/frontend/src/App.tsx` mounts
 * the `DashboardSlot` there and the dashboard-frontend plugin fills it with
 * three section extensions (welcome, system-health, recent-activity). This spec goes DEEPER than `smoke.spec.ts` (which only proves the
 * app shell boots): it asserts the dashboard's own overview section, its
 * fresh-install empty state, and the tips/help affordance (`TipBanner` from
 * `core/tips-frontend/src/components/TipBanner.tsx`) including dismissal.
 *
 * Runs in the authenticated `chromium` project (admin session from
 * `auth.setup.ts`) against a freshly-reset `checkstack_e2e` database, so there
 * are NO systems in the catalog - the dashboard renders its onboarding empty
 * state, which is exactly what we assert.
 *
 * Selectors are derived from the real component source (roles / accessible
 * names), never invented strings:
 * - `<h2>System health</h2>` is the dashboard's stable overview heading.
 * - The empty state (`EmptyState`) renders its title as a `<p>` (not a heading),
 *   so it is matched by exact text, not by role.
 * - The welcome `TipBanner` renders an X button with `aria-label="Dismiss tip"`.
 *
 * Serial: tests share one browser context, and the dismiss test mutates
 * server-persisted tip state, so it MUST run after the tests that assert the
 * banner is present.
 */

test.describe.configure({ mode: "serial" });

const NAV_TIMEOUT = 30_000;

test.describe("dashboard overview & tips banner", () => {
  test("the landing route renders the dashboard overview section", async ({
    page,
  }) => {
    await page.goto("/");

    // The dashboard's stable overview heading (volatile widget values are
    // avoided - this <h2> is always present once the slot mounts).
    await expect(
      page.getByRole("heading", { name: "System health", level: 2 }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });

    // Sanity: we are on the real dashboard, not the catch-all 404 or a crash.
    await expect(
      page.getByRole("heading", { name: "Route not found" }),
    ).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(
      "This page failed to load",
    );
  });

  test("a fresh install shows the dashboard onboarding empty state", async ({
    page,
  }) => {
    await page.goto("/");

    // EmptyState title (a <p>, not a heading) - matched by exact text because
    // getByText is a case-insensitive substring match by default.
    await expect(
      page.getByText("Nothing to show on the dashboard yet", { exact: true }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });

    // The coaching steps from the empty state are rendered.
    await expect(
      page.getByText(
        "Open the Catalog and add the systems you want to monitor.",
        { exact: true },
      ),
    ).toBeVisible();

    // Admins can manage the catalog, so the empty state's primary "Open Catalog"
    // CTA renders. The welcome tip banner also has an "Open Catalog" button, so
    // both the banner and the empty state contribute one each - assert at least
    // two are present (a missing empty-state CTA would leave only the banner's).
    await expect(
      page.getByRole("button", { name: "Open Catalog" }),
    ).toHaveCount(2);
  });

  test("with no systems, the empty state suppresses the activity feed and catalog link", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(
      page.getByText("Nothing to show on the dashboard yet", { exact: true }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });

    // "Recent activity" and the in-section "View catalog" link only render when
    // there is at least one system - on a fresh DB they must be absent.
    await expect(
      page.getByRole("heading", { name: "Recent activity" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "View catalog" }),
    ).toHaveCount(0);
  });

  test("the welcome tips banner renders with its lightbulb explanation hint", async ({
    page,
  }) => {
    await page.goto("/");

    // The TipBanner headline.
    await expect(
      page.getByText("Welcome to Checkstack", { exact: true }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });

    // The banner's actionHint coaches users about the lightbulb affordance.
    await expect(
      page.getByText(
        "See a small lightbulb next to a button or control? Click it for a short explanation of what that feature does.",
        { exact: true },
      ),
    ).toBeVisible();

    // The dismiss control exposes an accessible name (no destructive click here
    // - the dedicated dismissal test, which runs last, performs that).
    await expect(
      page.getByRole("button", { name: "Dismiss tip" }),
    ).toBeVisible();
  });

  test("the welcome tips banner can be dismissed and stays gone after reload", async ({
    page,
  }) => {
    await page.goto("/");

    const banner = page.getByText("Welcome to Checkstack", { exact: true });
    await expect(banner).toBeVisible({ timeout: NAV_TIMEOUT });

    await page.getByRole("button", { name: "Dismiss tip" }).click();

    // The banner disappears entirely once dismissed (no anchor remains).
    await expect(banner).toHaveCount(0);

    // Dismissal is persisted server-side for the logged-in admin, so it stays
    // dismissed across a reload - the banner must not reappear.
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "System health", level: 2 }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(banner).toHaveCount(0);
  });
});
