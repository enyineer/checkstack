import { test, expect } from "@checkstack/test-utils-frontend/playwright";
import type { Page } from "@playwright/test";

/**
 * RLAC / team-scoped GROUPS & ENVIRONMENTS, end to end through the UI.
 *
 * Proves the "system creators can also create groups & environments" self-service
 * feature: a plain member (NO global manage rule) whose team is granted the
 * SYSTEM create-capability (the "Allow System creation" toggle) can then, via the
 * `create.alsoAcceptCreatorOf` sibling gate:
 *
 *  - reach `/catalog/config` (create capability unlocks the surface);
 *  - see and use "Add Group" / "Add Environment" (the create verdict is true for a
 *    system creator, even with no group/environment grant of its own);
 *  - create a group and an environment, owned by their team (single-team members
 *    auto-own on the backend);
 *  - manage (delete) ONLY what they own: an admin-owned group is still VISIBLE
 *    (reads stay public) but offers the member no delete action (per-row
 *    `useResourceAccess` gating, matching the backend's per-instance manage check).
 *
 * Runs in the `chromium` (admin) project: seeds as admin, registers its OWN
 * namespaced member in a fresh context, grants live per request (member reload).
 */

test.describe.configure({ mode: "serial" });

const NS = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
const TEAM_NAME = `RLAC GE Team-${NS}`;
const ADMIN_GROUP = `RLAC Admin Group-${NS}`;
const MEMBER_GROUP = `RLAC Member Group-${NS}`;
const MEMBER_ENV = `RLAC Member Env-${NS}`;
const MEMBER = {
  name: `RLAC GE Member-${NS}`,
  email: `rlac-ge-member-${NS}@checkstack.local`,
  // Satisfies the register passwordSchema: >= 8 chars, upper, lower, number.
  password: "RlacMemberPass123",
};

const NAV = 60_000;

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
  await expect(page.getByRole("button", { name: MEMBER.name })).toBeVisible({
    timeout: NAV,
  });
}

/** Create a group through the catalog Groups tab (works for admin and member). */
async function createGroup(page: Page, name: string): Promise<void> {
  await page.goto("/catalog/config", { timeout: NAV });
  await expect(
    page.getByRole("heading", { name: "Catalog Management" }),
  ).toBeVisible({ timeout: NAV });
  await page.getByRole("tab", { name: "Groups" }).click();

  // Empty catalog shows "Add your first group"; otherwise "Add Group".
  const addFirst = page.getByRole("button", { name: "Add your first group" });
  const useFirst = await addFirst.isVisible().catch(() => false);
  await (useFirst
    ? addFirst
    : page.getByRole("button", { name: "Add Group" })
  ).click();

  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Create Group" }),
  ).toBeVisible();
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Create Group" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: NAV });
  await expect(page.getByRole("table").getByText(name)).toBeVisible({
    timeout: NAV,
  });
}

test("a system-creator team may also create & manage its own groups and environments", async ({
  page,
  browser,
}) => {
  // Long multi-actor flow (admin seed + member register + team grant + verify
  // across a second context), well past the 30s default.
  test.setTimeout(120_000);

  // --- ADMIN: seed a group the member must NOT be able to manage ----------
  await createGroup(page, ADMIN_GROUP);

  // --- MEMBER: register a dedicated non-admin in a fresh context -----------
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  try {
    await registerMember(memberPage);

    // Baseline: with no grant, the member cannot reach catalog management.
    await memberPage.goto("/catalog/config", { timeout: NAV });
    await expect(memberPage.getByText("Access Denied")).toBeVisible({
      timeout: NAV,
    });

    // --- ADMIN: team + member + grant the SYSTEM create capability ---------
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

    // Add the member by email.
    await manage
      .getByPlaceholder("Add a user by name or email")
      .fill(MEMBER.email);
    await page.getByRole("button", { name: new RegExp(MEMBER.name) }).click();
    await expect(page.getByText("Member added successfully")).toBeVisible({
      timeout: NAV,
    });

    // Grant ONLY the System create-capability (the "Resource creation" toggle).
    // The member gets NO group/environment grant of its own - the sibling gate
    // (`create.alsoAcceptCreatorOf: ["catalog.system"]`) is what must authorize
    // creating groups/environments.
    const systemToggle = manage.getByRole("switch", {
      name: "Allow System creation",
    });
    await expect(systemToggle).toBeVisible({ timeout: NAV });
    await systemToggle.click();
    await expect(systemToggle).toBeChecked({ timeout: NAV });

    // --- MEMBER: the system-create grant unlocks group/env self-service ----
    // Catalog management is now reachable (was Access Denied above).
    await memberPage.goto("/catalog/config", { timeout: NAV });
    await expect(
      memberPage.getByRole("heading", { name: "Catalog Management" }),
    ).toBeVisible({ timeout: NAV });

    // Create a GROUP as the member (single-team owner auto-assigns on the
    // backend). "Add Group" is offered purely via the sibling create gate.
    await createGroup(memberPage, MEMBER_GROUP);

    // Manage-scope: the member owns MEMBER_GROUP (delete offered) but NOT
    // ADMIN_GROUP - which is still VISIBLE (reads are public) yet offers no
    // delete action (per-row gating; the backend would reject the delete too).
    const groupsTable = memberPage.getByRole("table");
    await expect(groupsTable.getByText(ADMIN_GROUP)).toBeVisible();
    await expect(
      memberPage
        .getByRole("button", { name: `Delete ${MEMBER_GROUP}`, exact: true })
        .first(),
    ).toBeVisible();
    await expect(
      memberPage.getByRole("button", {
        name: `Delete ${ADMIN_GROUP}`,
        exact: true,
      }),
    ).toHaveCount(0);

    // Create an ENVIRONMENT as the member via the same sibling gate.
    await memberPage.getByRole("tab", { name: "Environments" }).click();
    const addEnvFirst = memberPage.getByRole("button", {
      name: "Add your first environment",
    });
    const useEnvFirst = await addEnvFirst.isVisible().catch(() => false);
    await (useEnvFirst
      ? addEnvFirst
      : memberPage.getByRole("button", { name: "Add Environment" })
    ).click();
    const envDialog = memberPage.getByRole("dialog");
    await expect(
      envDialog.getByRole("heading", { name: "Create Environment" }),
    ).toBeVisible();
    await envDialog.getByLabel("Name").fill(MEMBER_ENV);
    await envDialog
      .getByRole("button", { name: "Create Environment" })
      .click();
    await expect(memberPage.getByRole("dialog")).toHaveCount(0, {
      timeout: NAV,
    });
    // The member's environment lands and is theirs to manage (delete offered).
    await expect(
      memberPage.getByRole("table").getByText(MEMBER_ENV),
    ).toBeVisible({ timeout: NAV });
    await expect(
      memberPage
        .getByRole("button", { name: `Delete ${MEMBER_ENV}`, exact: true })
        .first(),
    ).toBeVisible();
  } finally {
    await memberContext.close();
  }
});
