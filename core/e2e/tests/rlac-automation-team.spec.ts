import { test, expect } from "@checkstack/test-utils-frontend/playwright";
import type { Page } from "@playwright/test";

/**
 * RLAC / team-scoped access for the AUTOMATION create/edit flow, end to end
 * through the UI.
 *
 * Regression guard for the "global-only team-grant" audit: the automation
 * list/create/edit surfaces gated their page `allowed` on the GLOBAL
 * `automation.read` rule (a bare `useAccess`), and the list/edit routes carried
 * no `manageCapability`. So a team-scoped user whose team holds an automation
 * CREATE capability (or a per-automation MANAGE grant) - but no global rule -
 * was locked out of the whole flow, even though the backend authorizes them
 * (`createAutomation` = create-capability, `updateAutomation`/`getAutomation` =
 * idParam, `listAutomations` = listKey). The pages now gate on
 * `useCanAccessType` and the routes declare `manageCapability`, so the full
 * flow is available to team creators/managers.
 *
 * This test proves, for a plain member with NO global rule whose team is granted
 * automation CREATE rights:
 *  - BEFORE the grant, the member is blocked from the create surface;
 *  - AFTER the grant, the member can reach the list, the template picker, and
 *    the blank editor (the create/edit page renders, not Access Denied);
 *  - can SELECT a service account to run the automation as - the
 *    `getBindableApplications` query resolves for them (it is not gated on a
 *    global rule), and a seeded service account with no access rules is bindable
 *    by a team creator (its rules are a subset of the caller's), so it appears
 *    in the "Run as (Service Account)" picker and can be chosen (no 403);
 *  - can SAVE the new automation (`createAutomation` = create-capability): the
 *    owning team auto-resolves to their one team, so the created automation is
 *    owned by that team;
 *  - and can then EDIT that team-owned automation (`updateAutomation` = idParam,
 *    authorized by the owning-team grant written at create time) - rename + save
 *    succeeds, proving the full create AND edit flow for a team creator.
 *
 * Runs in the `chromium` (admin) project: the test seeds as the admin, then
 * registers its OWN namespaced member in a fresh context. Team grants resolve
 * live per request, so the member only needs to reload to pick up new access.
 */

test.describe.configure({ mode: "serial" });

const NS = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
const SA_NAME = `RLAC-Auto SA-${NS}`;
const TEAM_NAME = `RLAC-Auto Team-${NS}`;
const AUTOMATION_NAME = `RLAC-Auto Flow-${NS}`;
const MEMBER = {
  name: `RLAC-Auto Member-${NS}`,
  email: `rlac-auto-member-${NS}@checkstack.local`,
  // Satisfies the register passwordSchema: >= 8 chars, upper, lower, number.
  password: "RlacAutoMemberPass123",
};

const NAV = 60_000;

/**
 * Create a service account (application) with NO access rules as the admin. An
 * app with no rules is bindable by a team creator who holds no global roles
 * (its effective rules are a subset of the caller's), so it appears in the
 * automation editor's "Run as" picker for that member.
 */
async function createServiceAccount(page: Page, name: string): Promise<void> {
  await page.goto("/auth/settings", { timeout: NAV });
  await page.getByRole("tab", { name: "Applications" }).click();
  await page
    .getByRole("button", { name: "Create Application" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Create Application" }),
  ).toBeVisible();
  await dialog.getByPlaceholder("My Application").fill(name);
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  // The one-time secret is shown in a follow-up dialog; dismiss it.
  await page.getByRole("button", { name: "Done" }).click();
  // The name appears in several cells/aria-labels of the row; assert the first.
  await expect(page.getByText(name).first()).toBeVisible({ timeout: NAV });
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

test("a team with automation-create rights gets the full create flow incl. service-account selection", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);

  // --- ADMIN: seed a bindable service account ----------------------------
  await createServiceAccount(page, SA_NAME);

  // --- MEMBER: register a dedicated non-admin in a fresh context ----------
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  try {
    await registerMember(memberPage);

    // Baseline NEGATIVE: with no grant and no global rule, the member cannot
    // reach the automation create surface.
    await memberPage.goto("/automation/new", { timeout: NAV });
    await expect(memberPage.getByText("Access Denied")).toBeVisible({
      timeout: NAV,
    });

    // --- ADMIN: create a team, add the member, grant CREATE rights ---------
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

    // The success toast fires BEFORE the teams list has refetched, so the new
    // row can lag behind it. Under full-suite load that lag has exceeded the
    // test timeout, which then reads as "the Manage button does not exist".
    // Reload if the row has not appeared rather than waiting indefinitely on a
    // refetch that may already have settled elsewhere.
    const manage = page.getByRole("dialog");
    await expect(async () => {
      const row = page.getByRole("row", { name: new RegExp(TEAM_NAME) });
      if (!(await row.isVisible().catch(() => false))) {
        await page.reload();
      }
      await row.getByRole("button", { name: /Manage/i }).click();
      await expect(
        manage.getByRole("heading", { name: new RegExp(`Manage ${TEAM_NAME}`) }),
      ).toBeVisible();
    }).toPass({ timeout: NAV });

    // Add the member.
    await manage
      .getByPlaceholder("Add a user by name or email")
      .fill(MEMBER.email);
    await page.getByRole("button", { name: new RegExp(MEMBER.name) }).click();
    await expect(page.getByText("Member added successfully")).toBeVisible({
      timeout: NAV,
    });

    // Grant the team the automation CREATE capability (a per-type switch,
    // label humanized from the access-rule resource "automation").
    const createSwitch = manage.getByRole("switch", {
      name: "Allow Automation creation",
    });
    await expect(createSwitch).toBeVisible({ timeout: NAV });
    await createSwitch.click();
    await expect(createSwitch).toBeChecked({ timeout: NAV });

    // --- MEMBER: the full create flow is now available ---------------------
    // The list is reachable (was global-only before).
    await memberPage.goto("/automation", { timeout: NAV });
    await expect(
      memberPage.getByRole("heading", { name: "Automations", exact: true }),
    ).toBeVisible({ timeout: NAV });
    await expect(memberPage.getByText("Access Denied")).toHaveCount(0);

    // The template picker is reachable.
    await memberPage.goto("/automation/new", { timeout: NAV });
    await expect(memberPage.getByText("Access Denied")).toHaveCount(0);
    await expect(
      memberPage.getByRole("heading", { name: "New automation" }),
    ).toBeVisible({ timeout: NAV });

    // The blank editor is reachable and interactive (the create/edit page
    // component - shared with edit - renders for a team creator).
    await memberPage.getByRole("button", { name: "Start blank" }).click();
    await expect(memberPage.getByLabel("Name")).toBeEnabled({ timeout: NAV });

    // POSITIVE "select a service account": the Run-as picker resolves under the
    // team grant (getBindableApplications is not global-gated), lists the seeded
    // service account, and it can be selected - no 403.
    await expect(
      memberPage.getByText("Run as (Service Account)"),
    ).toBeVisible({ timeout: NAV });
    await memberPage.locator("#runAs").click();
    const option = memberPage.getByRole("option", { name: SA_NAME });
    await expect(option).toBeVisible({ timeout: NAV });
    await option.click();
    // The trigger now reflects the chosen service account.
    await expect(memberPage.locator("#runAs")).toContainText(SA_NAME, {
      timeout: NAV,
    });

    // POSITIVE "create a new automation": name it, add a self-contained
    // "Interval" trigger (a definition needs at least one trigger to validate),
    // and SAVE. The member holds no global rule, so the owning-team picker
    // auto-resolves to their single team (a global resource would be uneditable
    // by them afterwards). `createAutomation` authorizes via the team's create
    // capability - no 403.
    await memberPage.getByLabel("Name").fill(AUTOMATION_NAME);

    // Add an Interval trigger via the Add-trigger picker, then fill its required
    // interval in the trigger sheet (mirrors the core automation create flow).
    await memberPage.getByRole("button", { name: "Add trigger" }).click();
    const triggerPicker = memberPage.getByRole("dialog");
    await expect(triggerPicker.getByText("Add trigger")).toBeVisible();
    await triggerPicker.getByText("Interval", { exact: true }).click();
    const triggerCard = memberPage.getByRole("button", { name: /Interval/ });
    await expect(triggerCard.first()).toBeVisible();
    await triggerCard.first().click();
    const triggerSheet = memberPage.getByRole("dialog", { name: "Interval" });
    const intervalField = triggerSheet.getByLabel("IntervalSeconds");
    await expect(intervalField).toBeVisible({ timeout: NAV });
    await intervalField.fill("60");
    // Close the trigger sheet via its Close button (Escape can miss when focus
    // sits in the spinbutton), then wait for it to detach so the editor's Save
    // control is no longer behind an aria-hidden overlay.
    await triggerSheet.getByRole("button", { name: "Close" }).click();
    await expect(triggerSheet).toBeHidden({ timeout: NAV });

    const save = memberPage.getByRole("button", { name: "Save" });
    await expect(save).toBeEnabled({ timeout: NAV });
    await save.click();
    // Create succeeds and redirects to the new automation's edit page.
    await expect(
      memberPage.getByText(`Created ${AUTOMATION_NAME}`),
    ).toBeVisible({ timeout: NAV });
    await memberPage.waitForURL(
      (url) =>
        /^\/automation\/[^/]+$/.test(url.pathname) &&
        !url.pathname.endsWith("/new") &&
        !url.pathname.endsWith("/blank"),
      { timeout: NAV },
    );

    // POSITIVE "edit an automation that belongs to their team": the edit page
    // now loads the team-owned automation (its `getAutomation` read + the Save
    // control resolve under the owning-team grant written at create time).
    // Rename and save - `updateAutomation` (idParam) authorizes via that grant.
    const renamed = `${AUTOMATION_NAME} (edited)`;
    const nameField = memberPage.getByLabel("Name");
    await expect(nameField).toHaveValue(AUTOMATION_NAME, { timeout: NAV });
    await expect(nameField).toBeEnabled();
    await nameField.fill(renamed);
    const saveEdit = memberPage.getByRole("button", { name: "Save" });
    await expect(saveEdit).toBeEnabled({ timeout: NAV });
    await saveEdit.click();
    await expect(memberPage.getByText(`Saved ${renamed}`)).toBeVisible({
      timeout: NAV,
    });
  } finally {
    await memberContext.close();
  }
});
