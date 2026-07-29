import { test, expect } from "@checkstack/test-utils-frontend/playwright";
import type { Page } from "@playwright/test";

/**
 * RLAC / team-scoped access for the HEALTH-CHECK editor and its embedded ANOMALY
 * settings, end to end through the UI.
 *
 * Regression guard for the "global-only team-grant" audit: the health-check
 * config editor's reads (`getStrategies` / `getCollectors`) and the anomaly
 * settings panel (`getAnomalyConfig` read + `updateAnomalyConfig` write) used to
 * require the GLOBAL rule, so a team-scoped manager who owns a check - but holds
 * no global health-check / anomaly rule - either could not open the editor or
 * saw an anomaly "Save Defaults" button whose Save always 403'd. The anomaly
 * writes now `parentScope` on the owning health-check configuration
 * (`healthcheck.healthcheck`), so managing the check authorizes reading and
 * editing its anomaly settings.
 *
 * This test proves, for a plain member with NO global rule:
 *  - BEFORE any grant, the member is blocked from the health-check config
 *    surface (route/capability gating);
 *  - AFTER a team MANAGE grant on ONE check, the member can open that check's
 *    editor and SEE its configuration (the editor's config reads succeed under a
 *    team grant, not just the global rule);
 *  - can view the check's Collector details (the editor's `getCollectors` read
 *    succeeds under the team grant - the exact endpoint that used to 403);
 *  - and can open the "Anomaly Defaults" panel and SAVE it (the anomaly
 *    read+write succeed under the team grant, via the new parentScope).
 *
 * Runs in the `chromium` (admin) project: the test seeds as the admin, then
 * registers its OWN namespaced member in a fresh context so it never depends on
 * (or perturbs) the shared MEMBER session. Team grants resolve live per request,
 * so the member only needs to reload to pick up the new access.
 *
 * NOTE: the sibling anomaly surface "Anomaly Exceptions" (in the per-system
 * ASSIGNMENT editor) is gated by MANAGE on the parent `catalog.system` - the
 * exact system-grant path already exercised end to end by
 * `rlac-team-scoped.spec.ts` (grant "System", then act on only that system). Its
 * write (`updateAnomalyAssignmentConfig`) now parentScopes on `catalog.system`
 * the same way, so the authorization path is covered; this spec focuses on the
 * check-owned surface.
 */

test.describe.configure({ mode: "serial" });

const NS = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
const CHECK = `RLAC-HC Check-${NS}`;
const TEAM_NAME = `RLAC-HC Team-${NS}`;
const MEMBER = {
  name: `RLAC-HC Member-${NS}`,
  email: `rlac-hc-member-${NS}@checkstack.local`,
  // Satisfies the register passwordSchema: >= 8 chars, upper, lower, number.
  password: "RlacHcMemberPass123",
};

const NAV = 60_000;

/** Create an HTTP health check as the admin, via the real create flow. */
async function createHealthCheck(page: Page, name: string): Promise<void> {
  await page.goto("/healthcheck/config/create", { timeout: NAV });
  await page
    .getByRole("heading", { name: "HTTP/HTTPS Health Check" })
    .click();
  await expect(
    page.getByRole("heading", { name: "New Health Check", level: 2 }),
  ).toBeVisible({ timeout: NAV });
  await page.getByLabel("Name").fill(name);
  const save = page.getByRole("button", { name: "Save" });
  await expect(save).toBeEnabled();
  await save.click();
  // Create navigates back to the config list where the new row shows up.
  await expect(
    page.getByRole("row", { name: new RegExp(name) }),
  ).toBeVisible({ timeout: NAV });
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

test("a team member managing a check can open its editor and manage its anomaly settings", async ({
  page,
  browser,
}) => {
  // Long multi-actor flow (seed a check, register a member, build a team +
  // grant, verify across a second context). Give it room.
  test.setTimeout(180_000);

  // --- ADMIN: seed a health check ----------------------------------------
  await createHealthCheck(page, CHECK);

  // --- MEMBER: register a dedicated non-admin in a fresh context ----------
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  try {
    await registerMember(memberPage);

    // Baseline NEGATIVE: with no grant and no global health-check rule, the
    // member cannot reach the health-check config surface at all.
    await memberPage.goto("/healthcheck/config", { timeout: NAV });
    await expect(memberPage.getByText("Access Denied")).toBeVisible({
      timeout: NAV,
    });

    // --- ADMIN: create a team, add the member, grant MANAGE on the check ----
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
    await createDialog
      .getByRole("button", { name: "Create", exact: true })
      .click();
    await expect(page.getByText("Team created successfully")).toBeVisible({
      timeout: NAV,
    });

    // Open the team's manage dialog.
    await page
      .getByRole("row", { name: new RegExp(TEAM_NAME) })
      .getByRole("button", { name: /Manage/i })
      .click();
    const manage = page.getByRole("dialog");
    await expect(
      manage.getByRole("heading", { name: new RegExp(`Manage ${TEAM_NAME}`) }),
    ).toBeVisible();

    // Add the member by email (combobox results are buttons in a portal).
    await manage
      .getByPlaceholder("Add a user by name or email")
      .fill(MEMBER.email);
    await page.getByRole("button", { name: new RegExp(MEMBER.name) }).click();
    await expect(page.getByText("Member added successfully")).toBeVisible({
      timeout: NAV,
    });

    // Grant MANAGE on the check: pick the "Healthcheck" resource type (the
    // health-check config type is humanized from its access-rule resource
    // "healthcheck"), then search + pick the check. A new grant defaults to
    // Manage (relation "editor").
    await manage.getByRole("combobox", { name: "Resource type" }).click();
    await page.getByRole("option", { name: "Healthcheck", exact: true }).click();
    const resourceSearch = manage.getByPlaceholder("Search resources by name");
    await resourceSearch.click();
    await resourceSearch.pressSequentially(CHECK, { delay: 30 });
    const grantResult = page.getByRole("button", { name: CHECK, exact: true });
    await expect(grantResult).toBeVisible({ timeout: 15_000 });
    await grantResult.click();
    await expect(page.getByText("Access granted")).toBeVisible({
      timeout: NAV,
    });

    // --- MEMBER: the grant unlocks the check editor + its config -----------
    // The config surface is now reachable (was Access Denied above).
    await memberPage.goto("/healthcheck/config", { timeout: NAV });
    const row = memberPage.getByRole("row", { name: new RegExp(CHECK) });
    await expect(row).toBeVisible({ timeout: NAV });

    // POSITIVE "see the check's configuration in the editor": open the editor
    // for the managed check. The editor loads its config (strategy/collector
    // reads succeed under the team grant) and seeds the saved Name.
    await row.getByRole("button", { name: "Edit configuration" }).click();
    await expect(
      memberPage.getByRole("heading", { name: `Edit: ${CHECK}`, level: 2 }),
    ).toBeVisible({ timeout: NAV });
    await expect(memberPage.getByLabel("Name")).toHaveValue(CHECK);

    // POSITIVE "view the Collector details": open the check-item picker. The
    // editor's `getCollectors` read - the exact endpoint that used to 403 for a
    // team-scoped manager - resolves under the team grant, so the picker lists
    // the strategy's collector by its DISPLAY NAME + description ("HTTP
    // Request"). If getCollectors had denied, availableCollectors would be
    // empty, the "Add check item" affordance would be absent, and this would
    // fail - so this asserts the member can view the collector details.
    await memberPage.getByRole("button", { name: /Add check item/ }).click();
    await expect(
      memberPage.getByRole("heading", { name: "Add Check Item" }),
    ).toBeVisible({ timeout: NAV });
    await expect(
      memberPage.getByRole("button", { name: /HTTP Request/ }),
    ).toBeVisible({ timeout: NAV });

    // POSITIVE "reach and manage these settings": open the "Anomaly Defaults"
    // panel (its `getAnomalyConfig` read now parentScopes on the check) and
    // save it (its `updateAnomalyConfig` write parentScopes on the check).
    await memberPage
      .getByRole("button", { name: "Anomaly Defaults" })
      .click();
    const saveDefaults = memberPage.getByRole("button", {
      name: "Save Defaults",
    });
    await expect(saveDefaults).toBeEnabled({ timeout: NAV });
    await saveDefaults.click();
    await expect(
      memberPage.getByText("Anomaly detection settings saved"),
    ).toBeVisible({ timeout: NAV });
  } finally {
    await memberContext.close();
  }
});
