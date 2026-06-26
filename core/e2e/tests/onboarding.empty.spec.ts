import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Onboarding / empty-state assertions that require a PRISTINE database.
 *
 * The e2e suite runs on a boot-once model: a single backend/Postgres is booted
 * for the whole run, and the data specs are data-isolated so they can run in
 * parallel. This file is different - every test here asserts the brand-new,
 * nothing-created-yet onboarding state ("No systems yet", "No secrets yet",
 * "No teams found.", etc.). Those assertions are only true while the DB is
 * empty, so this file runs in the boot-once `empty-state` project: a pristine
 * DB with the admin onboarded and nothing else created, scheduled BEFORE any
 * data spec (the parallel data specs depend on the `empty-state` project, so it
 * completes first while the DB is still empty).
 *
 * Every test below CREATES NOTHING - it only navigates and asserts the empty /
 * onboarding / CTA state. There is intentionally no
 * `test.describe.configure({ mode: "serial" })`: these are read-only and
 * order-independent. Selectors and timeouts are copied verbatim from the
 * pre-conversion per-domain specs (catalog, incident, automation, secrets,
 * announcement, slo, healthcheck, satellite, auth, status-page, maintenance).
 */

const NAV_TIMEOUT = 30_000;

test.describe("Catalog (empty state)", () => {
  test("browse shows the empty catalog state with a link to management", async ({
    page,
  }) => {
    await page.goto("/catalog/", { timeout: NAV_TIMEOUT });

    await expect(
      page.getByRole("heading", { name: "Catalog", exact: true }),
    ).toBeVisible();

    // Onboarding empty state for a brand-new, system-less catalog.
    await expect(
      page.getByText("No systems in the catalog yet"),
    ).toBeVisible();

    // The empty state offers a CTA into catalog management.
    const addFirst = page.getByRole("link", {
      name: "Add your first system",
    });
    await expect(addFirst).toBeVisible();
    await expect(addFirst).toHaveAttribute("href", "/catalog/config");
  });

  test("management page shows empty systems and groups states", async ({
    page,
  }) => {
    await page.goto("/catalog/config", { timeout: NAV_TIMEOUT });

    await expect(
      page.getByRole("heading", { name: "Catalog Management" }),
    ).toBeVisible();

    // The Systems tab (default) starts empty with its CTA.
    await expect(page.getByText("No systems yet")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add System" }),
    ).toBeVisible();

    // The Groups tab starts empty too.
    await page.getByRole("tab", { name: "Groups" }).click();
    await expect(page.getByText("No groups yet")).toBeVisible();
  });
});

test.describe("Incidents (empty state)", () => {
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
});

test.describe("Automations (empty state)", () => {
  test("list shows the empty state on a fresh install", async ({ page }) => {
    await page.goto("/automation/");

    await expect(
      page.getByRole("heading", { name: "Automations", exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    // The admin can manage, so the create affordance is present.
    await expect(
      page.getByRole("link", { name: "New automation" }),
    ).toBeVisible();
    await expect(page.getByText("No automations yet")).toBeVisible();
  });
});

test.describe("Secrets (empty state)", () => {
  test("shows the empty state with no secrets", async ({ page }) => {
    await page.goto("/secrets/", { waitUntil: "domcontentloaded" });

    // The page-level title renders as an <h2>; the list card uses an <h3>
    // also titled "Secrets", so scope to the heading level to disambiguate.
    await expect(
      page.getByRole("heading", { name: "Secrets", level: 2 }),
    ).toBeVisible({ timeout: 30_000 });

    // Create form is present (local backend is writable).
    await expect(
      page.getByRole("heading", { name: "Add a secret" }),
    ).toBeVisible();

    // Empty-state copy for a writable backend.
    await expect(page.getByText("No secrets yet. Add one above.")).toBeVisible();
  });
});

test.describe("Announcements (empty state)", () => {
  test("shows the empty state when no announcements exist", async ({
    page,
  }) => {
    await page.goto("/announcement/manage", { waitUntil: "domcontentloaded" });

    // Page chrome from PageLayout.
    await expect(
      page.getByRole("heading", { name: "Announcement Management" }),
    ).toBeVisible({ timeout: 30_000 });

    // Empty state copy from the manage page (EmptyState renders the title as a
    // paragraph, not a heading).
    await expect(page.getByText("No announcements yet")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create your first announcement" }),
    ).toBeVisible();
  });
});

test.describe("SLOs (empty state)", () => {
  test("overview renders its empty state when no SLOs exist", async ({
    page,
  }) => {
    await page.goto("/slo/", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { name: "SLO Dashboard" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText("Service Level Objective performance across all systems"),
    ).toBeVisible();

    // Empty state copy from SloOverviewPage. The shared EmptyState component
    // renders its title as a paragraph, not a heading.
    await expect(page.getByText("No SLOs configured")).toBeVisible();

    // The empty state links to SLO management.
    await expect(
      page.getByRole("link", { name: "Manage SLOs" }).first(),
    ).toBeVisible();

    // We must not have landed on the catch-all 404.
    await expect(page.locator("body")).not.toContainText("Route not found");
  });

  test("config page renders its empty state when no objectives exist", async ({
    page,
  }) => {
    await page.goto("/slo/config", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { name: "SLO Management" }),
    ).toBeVisible({ timeout: 30_000 });

    // Empty state copy from SloConfigPage. The shared EmptyState component
    // renders its title as a paragraph, not a heading.
    await expect(page.getByText("No SLO objectives yet")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create your first SLO" }),
    ).toBeVisible();
  });
});

test.describe("Health checks (empty state)", () => {
  test("config list shows the empty state before any checks exist", async ({
    page,
  }) => {
    await page.goto("/healthcheck/config", { timeout: NAV_TIMEOUT });

    // Page chrome.
    await expect(
      page.getByRole("heading", { name: "Health Checks", level: 2 }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(
      page.getByRole("button", { name: "Create Check" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Quick start" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "View History" }),
    ).toBeVisible();

    // ListEmptyState renders "No {resource} yet" (a styled <p>, not a heading)
    // plus the descriptive copy and a guided-setup CTA.
    await expect(page.getByText("No health checks yet")).toBeVisible();
    await expect(
      page.getByText(
        "The quickest way to start is the guided setup: name a system, paste a URL, and we create and start monitoring it for you.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create your first check" }),
    ).toBeVisible();
  });

  test("history page renders its empty run table initially", async ({
    page,
  }) => {
    await page.goto("/healthcheck/history", { timeout: NAV_TIMEOUT });

    await expect(
      page.getByRole("heading", { name: "Health Check History", level: 2 }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(
      page.getByRole("heading", { name: "Run History" }),
    ).toBeVisible();
    // Empty in-table message from HealthCheckRunsTable's default. Scope to the
    // desktop table cell: the ResponsiveTable's display:none MobileCardList
    // renders the same empty-state text, which would trip strict mode.
    await expect(
      page.getByRole("cell", { name: "No health check runs found." }),
    ).toBeVisible();
  });
});

test.describe("Satellites (empty state)", () => {
  test("renders the page chrome with title, subtitle and create action", async ({
    page,
  }) => {
    await page.goto("/satellite/", { waitUntil: "load", timeout: 30_000 });

    // PageLayout renders the title as an <h2> heading.
    await expect(
      page.getByRole("heading", { name: "Satellites" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Manage distributed satellite nodes for remote health check execution",
      ),
    ).toBeVisible();

    // The "Satellite Nodes" card is always present.
    await expect(
      page.getByText("Satellite Nodes", { exact: true }),
    ).toBeVisible();

    // The header action button to register a satellite.
    await expect(
      page.getByRole("button", { name: "Create Satellite", exact: true }),
    ).toBeVisible();

    // We must NOT be on the catch-all 404.
    await expect(page.locator("body")).not.toContainText("Route not found");
  });

  test("shows the onboarding empty state when no satellites are registered", async ({
    page,
  }) => {
    await page.goto("/satellite/", { waitUntil: "load", timeout: 30_000 });

    await expect(page.getByText("No satellites yet")).toBeVisible();
    await expect(
      page.getByText(
        /A satellite is a small Checkstack agent you run somewhere else/,
      ),
    ).toBeVisible();

    // The numbered onboarding steps render as a list.
    await expect(
      page.getByText(
        "Create a satellite here to mint a registration token.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        /Deploy the satellite container or binary on the target machine/,
      ),
    ).toBeVisible();
    await expect(
      page.getByText(/Once it's online, assign health checks to it/),
    ).toBeVisible();

    // The empty state offers its own "Create satellite" CTA (distinct casing
    // from the header button) since the admin has manage access.
    await expect(
      page.getByRole("button", { name: "Create satellite", exact: true }),
    ).toBeVisible();
  });
});

test.describe("Auth admin (empty state)", () => {
  test("applications tab starts empty and offers a create action", async ({
    page,
  }) => {
    await page.goto("/auth/settings", { timeout: NAV_TIMEOUT });
    await expect(
      page.getByRole("heading", { name: "Authentication Settings" }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });
    const tab = page.getByRole("tab", { name: "Applications" });
    await expect(tab).toBeVisible();
    await tab.click();

    await expect(
      page.getByRole("heading", { name: "External Applications" }),
    ).toBeVisible();
    // Brand-new DB: no external applications yet.
    await expect(
      page.getByText("No external applications configured yet."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create Application" }),
    ).toBeVisible();
  });

  test("teams page starts empty with a create action", async ({ page }) => {
    await page.goto("/auth/teams", { timeout: NAV_TIMEOUT });

    await expect(
      page.getByRole("heading", { name: "Teams" }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(
      page.getByText("Manage team membership, managers, and resource access."),
    ).toBeVisible();

    // Fresh DB: no teams exist yet.
    await expect(page.getByText("No teams found.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create Team" }),
    ).toBeVisible();
  });
});

test.describe("Status pages (empty state)", () => {
  test("list renders its empty state when no pages exist", async ({ page }) => {
    await page.goto("/statuspage", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { name: "Status pages" }),
    ).toBeVisible({ timeout: 30_000 });
    // Empty state copy from StatusPagesListPage.
    await expect(page.getByText("No status pages yet")).toBeVisible();
    // We must not have landed on the catch-all 404.
    await expect(page.locator("body")).not.toContainText("Route not found");
  });
});

test.describe("Maintenance windows (empty state)", () => {
  test("shows the empty state before any maintenance exists", async ({
    page,
  }) => {
    await page.goto("/maintenance/config", { waitUntil: "commit" });

    await expect(
      page.getByRole("heading", { name: "Planned Maintenances" }),
    ).toBeVisible({ timeout: 30_000 });

    await expect(page.getByText("No planned maintenances")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Schedule maintenance" }),
    ).toBeVisible();
  });
});
