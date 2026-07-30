import { test, expect } from "@checkstack/test-utils-frontend/playwright";
import type { Page } from "@playwright/test";

/**
 * RLAC / team-scoped access, end to end through the UI.
 *
 * Proves that a plain member (NO global manage rule) who is added to a team that
 * is granted MANAGE on ONE system can then reach the management surfaces and act
 * on ONLY that system - the behaviour the platform's capability gating and
 * picker filtering are supposed to deliver:
 *
 *  - before any grant, the member is blocked from `/catalog/config` and has no
 *    "Manage Incidents" nav (route/nav capability gating; the read-gated public
 *    "Incidents" overview stays visible to everyone);
 *  - after the grant, the member can reach catalog management and the incidents
 *    surface (`useCanAccessType` / `manageCapability`);
 *  - the incident "Affected Systems" picker offers ONLY the granted system, not
 *    the other one (`useResourceAccess` picker filtering, matching the backend's
 *    per-system authorization);
 *  - the member can actually create the incident, with the owning team
 *    auto-selected (the owning-team-required fix), and the backend accepts it.
 *
 * Runs in the `chromium` (admin) project: the test seeds as the admin, then
 * registers its OWN namespaced member in a fresh context so it never depends on
 * (or perturbs) the shared MEMBER session used by `permissions.spec.ts`. Team
 * grants are resolved live per request, so the member only needs to reload to
 * pick up the new access.
 */

test.describe.configure({ mode: "serial" });

const NS = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
const SYS_MANAGED = `RLAC Managed-${NS}`;
const SYS_OTHER = `RLAC Other-${NS}`;
const TEAM_NAME = `RLAC Team-${NS}`;
const INCIDENT_TITLE = `RLAC incident-${NS}`;
const MEMBER = {
  name: `RLAC Member-${NS}`,
  email: `rlac-member-${NS}@checkstack.local`,
  // Satisfies the register passwordSchema: >= 8 chars, upper, lower, number.
  password: "RlacMemberPass123",
};

const NAV = 60_000;

/** Create a catalog system as the admin. */
async function createSystem(page: Page, name: string): Promise<void> {
  await page.goto("/catalog/config", { timeout: NAV });
  await expect(
    page.getByRole("heading", { name: "Catalog Management" }),
  ).toBeVisible({ timeout: NAV });

  // Empty catalog shows "Add your first system"; otherwise "Add System".
  const addFirst = page.getByRole("button", { name: "Add your first system" });
  const useFirst = await addFirst.isVisible().catch(() => false);
  await (useFirst
    ? addFirst
    : page.getByRole("button", { name: "Add System" })
  ).click();

  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Create System" }),
  ).toBeVisible();
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Create System" }).click();
  await expect(page.getByRole("table").getByText(name)).toBeVisible({
    timeout: NAV,
  });
}

/** Self-register a fresh, non-admin member and land logged in. */
async function registerMember(page: Page): Promise<void> {
  await page.goto("/auth/register", { timeout: NAV });
  await expect(
    page.getByRole("heading", { name: "Create your account" }),
  ).toBeVisible({ timeout: NAV });
  await page.locator("#name").fill(MEMBER.name);
  await page.locator("#email").fill(MEMBER.email);
  await page.locator("#password").fill(MEMBER.password);
  await page.getByRole("button", { name: "Create Account" }).click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: NAV });
  await expect(
    page.getByRole("button", { name: MEMBER.name }),
  ).toBeVisible({ timeout: NAV });
}

test("a team member manages only the systems their team is granted", async ({
  page,
  browser,
}) => {
  // This is a long multi-actor flow (seed two systems, register a member, build
  // a team + grant, then verify across a second context), well past the 30s
  // default. Give it room.
  test.setTimeout(120_000);

  // --- ADMIN: seed two systems -------------------------------------------
  await createSystem(page, SYS_MANAGED);
  await createSystem(page, SYS_OTHER);

  // --- MEMBER: register a dedicated non-admin in a fresh context ----------
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  try {
    await registerMember(memberPage);

    // Baseline: with no grant, the member cannot reach catalog management and
    // has no incident-management nav entry. (The read-gated public "Incidents"
    // overview is intentionally visible to everyone, so gate on the
    // manageCapability-gated "Manage Incidents" nav instead.)
    await memberPage.goto("/catalog/config", { timeout: NAV });
    await expect(memberPage.getByText("Access Denied")).toBeVisible({
      timeout: NAV,
    });
    await expect(
      memberPage.getByRole("link", { name: "Manage Incidents", exact: true }),
    ).toHaveCount(0);

    // --- ADMIN: create a team, add the member, grant MANAGE on SYS_MANAGED --
    await page.goto("/auth/teams", { timeout: NAV });
    await expect(page.getByRole("heading", { name: "Teams" })).toBeVisible({
      timeout: NAV,
    });
    await page.getByRole("button", { name: "Create Team" }).click();
    const createDialog = page.getByRole("dialog");
    await expect(
      createDialog.getByRole("heading", { name: "Create Team" }),
    ).toBeVisible();
    await createDialog.getByLabel("Name").fill(TEAM_NAME);
    await createDialog.getByRole("button", { name: "Create", exact: true }).click();

    // The teams list can lag the create: the success toast that used to be
    // asserted here fires BEFORE the list refetches, so waiting on it never
    // helped, and under full-suite load the lag has exceeded the test timeout.
    // Reload if the row has not appeared rather than waiting indefinitely on a
    // refetch that may already have settled elsewhere. Same pattern as
    // rlac-automation-team.spec.ts, which is why that spec stays green under
    // load while this one did not.
    const manage = page.getByRole("dialog");
    await expect(async () => {
      const row = page.getByRole("row", { name: new RegExp(TEAM_NAME) });
      if (!(await row.isVisible().catch(() => false))) {
        await page.reload();
      }
      await row.getByRole("button", { name: /Manage/i }).click();
      // SHORT: inside a `toPass` loop, so it must fail fast enough to retry.
      await expect(
        manage.getByRole("heading", { name: new RegExp(`Manage ${TEAM_NAME}`) }),
      ).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: NAV });

    // Add the member by email (combobox results are buttons in a portal).
    await manage
      .getByPlaceholder("Add a user by name or email")
      .fill(MEMBER.email);
    await page
      .getByRole("button", { name: new RegExp(MEMBER.name) })
      .click();
    // Durable outcome, not the auto-dismissing toast: the member is now listed
    // in the team's manage dialog.
    await expect(
      manage.getByText(MEMBER.email, { exact: false }),
    ).toBeVisible({ timeout: NAV });

    // Grant MANAGE on SYS_MANAGED: pick the "System" type, then search. A new
    // grant defaults to Manage (relation "editor"). Type char-by-char so the
    // debounced search-as-you-type fires, and wait for the result to render
    // before clicking it.
    await manage.getByRole("combobox", { name: "Resource type" }).click();
    await page.getByRole("option", { name: "System", exact: true }).click();
    const resourceSearch = manage.getByPlaceholder("Search resources by name");
    await resourceSearch.click();
    await resourceSearch.pressSequentially(SYS_MANAGED, { delay: 30 });
    const grantResult = page.getByRole("button", {
      name: SYS_MANAGED,
      exact: true,
    });
    await expect(grantResult).toBeVisible({ timeout: 15_000 });
    await grantResult.click();
    await expect(page.getByText("Access granted")).toBeVisible({
      timeout: NAV,
    });

    // --- MEMBER: the grant unlocks exactly the granted system --------------
    // Catalog management is now reachable (was Access Denied above).
    await memberPage.goto("/catalog/config", { timeout: NAV });
    await expect(
      memberPage.getByRole("heading", { name: "Catalog Management" }),
    ).toBeVisible({ timeout: NAV });

    // Per-resource NEGATIVE path: the member can act on ONLY the system their
    // team manages. Both systems are readable and listed, but the granted one
    // has edit/delete row actions while the non-granted one has NONE (per-row
    // `useResourceAccess` gating; the backend would reject an edit too).
    await expect(
      memberPage
        .getByRole("button", { name: `Edit ${SYS_MANAGED}`, exact: true })
        .first(),
    ).toBeVisible({ timeout: NAV });
    await expect(
      memberPage.getByRole("button", { name: `Edit ${SYS_OTHER}`, exact: true }),
    ).toHaveCount(0);

    // The incidents surface is now reachable via capability gating.
    await memberPage.goto("/incident/config", { timeout: NAV });
    const reportButton = memberPage.getByRole("button", {
      name: "Report Incident",
      exact: true,
    });
    await expect(reportButton).toBeVisible({ timeout: NAV });

    // The "Affected Systems" picker offers ONLY the managed system.
    await reportButton.click();
    const incidentDialog = memberPage.getByRole("dialog");
    await expect(
      incidentDialog.getByRole("heading", { name: "Create Incident" }),
    ).toBeVisible();
    await expect(incidentDialog.getByText(SYS_MANAGED)).toBeVisible();
    await expect(incidentDialog.getByText(SYS_OTHER)).toHaveCount(0);

    // And the member can create it: the owning team auto-selects (their only
    // eligible owner), and the backend - which requires manage on the system -
    // accepts it.
    await incidentDialog.getByLabel("Title").fill(INCIDENT_TITLE);
    // Select the managed system via its checkbox within the Affected Systems
    // group (the dialog also has a "Suppress notifications" checkbox, so scope to
    // the group; only the managed system is offered here).
    await incidentDialog
      .getByRole("group", { name: /Affected Systems/ })
      .getByRole("checkbox")
      .click();
    await expect(
      incidentDialog.getByText("1 system(s) selected"),
    ).toBeVisible();
    await incidentDialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(incidentDialog).toBeHidden({ timeout: NAV });
    await expect(
      memberPage.getByRole("row", { name: new RegExp(INCIDENT_TITLE) }),
    ).toBeVisible({ timeout: NAV });
  } finally {
    await memberContext.close();
  }
});
