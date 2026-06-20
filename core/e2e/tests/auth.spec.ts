import { test, expect } from "@checkstack/test-utils-frontend/playwright";
import type { Page } from "@playwright/test";

/**
 * Authenticated E2E coverage for the auth ADMIN surface that
 * `profile.spec.ts` / `permissions.spec.ts` do NOT touch.
 *
 * `profile.spec.ts` already covers: the profile page, the change-password
 * flow + validation, the "Auth Strategies" tab listing "Email & Password" +
 * the "Reload Authentication" control, and logout. `permissions.spec.ts`
 * covers the Access-Denied gate for a non-admin. This file therefore exercises
 * the remaining high-value admin flows on the Auth Settings page:
 *  - tab navigation across Users & Roles / Roles & Access Rules / Applications
 *  - the Applications tab: create -> one-time secret dialog -> list -> delete
 *  - the Strategies tab's Platform Settings (registration) controls
 * and the standalone Teams page (create / edit / delete).
 *
 * The browser is already authenticated as the onboarded admin (storageState
 * from `auth.setup.ts`), so navigating to the auth routes renders the in-app
 * pages directly.
 *
 * Boot-once variant: the backend boots and the DB is reset ONCE, then all
 * specs run in PARALLEL against that single shared DB. The DB is therefore
 * non-empty and shared, so this file is fully data-isolated: every entity it
 * creates (applications/service-accounts, teams) is namespaced with a
 * unique-per-run suffix (`NS`) so parallel specs never collide, and no test
 * asserts on global table state (no empty-state, no global counts). Tests
 * within this file still run serially (the create -> edit -> delete chains).
 *
 * Routes exercised (plugin-prefixed):
 *   /auth/settings   - tabbed admin settings (users, roles, strategies, apps)
 *   /auth/teams      - standalone team management
 */
test.describe.configure({ mode: "serial" });

// Unique per run so parallel specs sharing one DB never collide on names.
const NS = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
const APP_NAME = `E2E Service Account-${NS}`;
const APP_DESCRIPTION = "Created by the auth E2E spec";
const TEAM_NAME = `Platform Team-${NS}`;
const TEAM_DESCRIPTION = "Owns the core platform services";
const TEAM_NAME_EDITED = `Platform Squad-${NS}`;

const NAV_TIMEOUT = 30_000;

/** Open the Auth Settings page and switch to the named tab. */
async function openSettingsTab(page: Page, tabName: string): Promise<void> {
  await page.goto("/auth/settings", { timeout: NAV_TIMEOUT });
  await expect(
    page.getByRole("heading", { name: "Authentication Settings" }),
  ).toBeVisible({ timeout: NAV_TIMEOUT });
  const tab = page.getByRole("tab", { name: tabName });
  await expect(tab).toBeVisible();
  await tab.click();
}

test.describe("auth admin: settings tabs, applications & teams", () => {
  test("auth settings exposes the admin tabs for a platform admin", async ({
    page,
  }) => {
    await page.goto("/auth/settings", { timeout: NAV_TIMEOUT });

    await expect(
      page.getByRole("heading", { name: "Authentication Settings" }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });

    // The admin sees every access-gated tab. (profile.spec only visits the
    // "Auth Strategies" tab; here we assert the full admin tablist exists.)
    await expect(
      page.getByRole("tab", { name: "Users & Roles" }),
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "Roles & Access Rules" }),
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "Auth Strategies" }),
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "Applications" }),
    ).toBeVisible();
  });

  test("strategies tab renders the platform registration settings", async ({
    page,
  }) => {
    await openSettingsTab(page, "Auth Strategies");

    // The Platform Settings card holds the registration toggle (rendered by
    // DynamicForm from the registration schema) and its Save action. This is
    // the registration-management surface; profile.spec only checks the
    // strategy listing + reload button, not these controls.
    await expect(
      page.getByRole("heading", { name: "Platform Settings" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save Settings" }),
    ).toBeVisible();
  });

  test("creating an application shows the one-time secret then lists it", async ({
    page,
  }) => {
    await openSettingsTab(page, "Applications");

    await page
      .getByRole("button", { name: "Create Application" })
      .click();

    const createDialog = page.getByRole("dialog");
    await expect(
      createDialog.getByRole("heading", { name: "Create Application" }),
    ).toBeVisible();

    // The create dialog's inputs are plain <input>s whose <label>s are NOT
    // associated (no htmlFor/id), so getByLabel can't reach them; target them
    // by their (exact) placeholders instead.
    await createDialog
      .getByPlaceholder("My Application", { exact: true })
      .fill(APP_NAME);
    await createDialog
      .getByPlaceholder("What does this application do?", { exact: true })
      .fill(APP_DESCRIPTION);

    // The dialog's submit button is "Create" (becomes "Creating..." while
    // pending). Scope to the dialog so we don't hit the card's
    // "Create Application" trigger behind the modal.
    await createDialog.getByRole("button", { name: "Create" }).click();

    // On success the create dialog closes and the one-time SECRET dialog opens,
    // titled with the application name and warning that the secret is shown
    // once. We dismiss it via "Done".
    const secretDialog = page.getByRole("dialog");
    await expect(
      secretDialog.getByRole("heading", {
        name: `Application Secret: ${APP_NAME}`,
      }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });
    // The warning copy uses an em-dash in the source; match the leading,
    // dash-free fragment so the assertion doesn't depend on that glyph.
    await expect(
      secretDialog.getByText("Copy this secret now", { exact: false }),
    ).toBeVisible();

    await secretDialog.getByRole("button", { name: "Done" }).click();

    // No dialog remains; the modal aria-hides the page behind it, so the table
    // is only reachable by role once every dialog is gone.
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // The new application appears in the list. Scope to the desktop `<table>`:
    // the ResponsiveTable also renders a display:none MobileCardList with the
    // same name, so an unscoped getByText would trip strict mode.
    await expect(
      page.getByRole("table").getByText(APP_NAME),
    ).toBeVisible();
  });

  test("deletes the application with confirmation", async ({ page }) => {
    await openSettingsTab(page, "Applications");

    // The application from the previous test is present (scoped to the desktop
    // table to avoid the MobileCardList duplicate).
    const appRow = page
      .getByRole("table")
      .getByRole("row")
      .filter({ hasText: APP_NAME });
    await expect(appRow).toBeVisible();

    // The delete action is the trailing ghost button in the row's Actions cell
    // (the leading one regenerates the secret).
    await appRow.getByRole("button").last().click();

    // The confirmation modal names the action; confirm the delete.
    const confirm = page.getByRole("dialog");
    await expect(
      confirm.getByText("Delete Application"),
    ).toBeVisible();
    // The ConfirmationModal uses its default confirm label ("Confirm").
    await confirm.getByRole("button", { name: "Confirm" }).click();

    await expect(
      page.getByText("Application deleted successfully"),
    ).toBeVisible({ timeout: NAV_TIMEOUT });

    // Only OUR namespaced application is gone. The shared DB may still hold
    // applications created by other parallel specs, so we never assert a global
    // empty state - just that our own row disappeared.
    await expect(
      page.getByRole("table").getByText(APP_NAME),
    ).toHaveCount(0);
  });

  test("creates a team and lists it", async ({ page }) => {
    await page.goto("/auth/teams", { timeout: NAV_TIMEOUT });
    await expect(
      page.getByRole("heading", { name: "Teams" }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });

    await page.getByRole("button", { name: "Create Team" }).click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Create Team" }),
    ).toBeVisible();

    await dialog.getByLabel("Name").fill(TEAM_NAME);
    await dialog.getByLabel("Description").fill(TEAM_DESCRIPTION);
    await dialog.getByRole("button", { name: "Create" }).click();

    await expect(
      page.getByText("Team created successfully"),
    ).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // The team appears in the list. Scope to the desktop table: the
    // MobileCardList duplicates the name in the DOM.
    await expect(
      page.getByRole("table").getByText(TEAM_NAME),
    ).toBeVisible();
    await expect(
      page.getByRole("table").getByText(TEAM_DESCRIPTION),
    ).toBeVisible();
  });

  test("edits a team's name", async ({ page }) => {
    await page.goto("/auth/teams", { timeout: NAV_TIMEOUT });
    await expect(
      page.getByRole("heading", { name: "Teams" }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });

    const teamRow = page
      .getByRole("table")
      .getByRole("row")
      .filter({ hasText: TEAM_NAME });
    await expect(teamRow).toBeVisible();

    // The edit action is the middle ghost button in the row's Actions cell
    // (manage members, edit, delete).
    await teamRow.getByRole("button").nth(1).click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Edit Team" }),
    ).toBeVisible();

    const nameField = dialog.getByLabel("Name");
    await expect(nameField).toHaveValue(TEAM_NAME);
    await nameField.fill(TEAM_NAME_EDITED);
    await dialog.getByRole("button", { name: "Update" }).click();

    await expect(
      page.getByText("Team updated successfully"),
    ).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("table").getByText(TEAM_NAME_EDITED),
    ).toBeVisible();
  });

  test("deletes a team with confirmation", async ({ page }) => {
    await page.goto("/auth/teams", { timeout: NAV_TIMEOUT });
    await expect(
      page.getByRole("heading", { name: "Teams" }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });

    const teamRow = page
      .getByRole("table")
      .getByRole("row")
      .filter({ hasText: TEAM_NAME_EDITED });
    await expect(teamRow).toBeVisible();

    // The delete action is the trailing ghost button in the row's Actions cell.
    await teamRow.getByRole("button").last().click();

    const confirm = page.getByRole("dialog");
    await expect(confirm.getByText("Delete Team")).toBeVisible();
    // The ConfirmationModal uses its default confirm label ("Confirm").
    await confirm.getByRole("button", { name: "Confirm" }).click();

    await expect(
      page.getByText("Team deleted successfully"),
    ).toBeVisible({ timeout: NAV_TIMEOUT });

    // Only OUR namespaced team is gone. The shared DB may still hold teams
    // created by other parallel specs, so we never assert a global empty state
    // - just that our own (edited) row disappeared.
    await expect(
      page.getByRole("table").getByText(TEAM_NAME_EDITED),
    ).toHaveCount(0);
  });
});
