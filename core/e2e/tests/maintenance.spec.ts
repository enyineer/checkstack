import { test, expect, type Page } from "@checkstack/test-utils-frontend/playwright";

/**
 * Authenticated E2E coverage for the "Maintenance windows" area.
 *
 * The whole file shares ONE freshly-reset, empty database (only the admin user
 * exists at start), so tests run serially and the empty-state assertions run
 * before anything is created. A system is created up front via the catalog UI
 * because every maintenance window must target at least one system.
 *
 * Routes exercised:
 *   /catalog/config              - create the prerequisite system
 *   /catalog/                    - resolve the created system's id from its row link
 *   /maintenance/config          - manage (list, create, edit, delete) windows
 *   /maintenance/system/:id/...  - history list (the only UI path into detail)
 *   /maintenance/:id             - detail page (reached by clicking a history row)
 */

test.describe.configure({ mode: "serial" });

const SYSTEM_NAME = `Maintenance Sys ${Date.now()}`;
const WINDOW_TITLE = `DB upgrade ${Date.now()}`;
const WINDOW_TITLE_EDITED = `${WINDOW_TITLE} (edited)`;
const WINDOW_DESCRIPTION = "Rolling restart of the primary database cluster.";

/** systemId resolved from the catalog browse row link; shared across tests. */
let systemId = "";

/**
 * Fill the DateTimePicker that owns the given Date & Time label. The picker has
 * no single labelled input, so we scope to the labelled field group and drive
 * its DD/MM/YYYY + HH/MM text inputs by their placeholders. The editor now wraps
 * each datetime field in a `role="group"` labelled (via aria-labelledby) by its
 * "Start Date & Time" / "End Date & Time" label, so locate the group by role.
 */
async function fillDateTime({
  page,
  label,
  date,
}: {
  page: Page;
  label: string;
  date: Date;
}): Promise<void> {
  const group = page.getByRole("group", { name: label });

  const pad = (value: number): string => String(value).padStart(2, "0");

  await group.getByPlaceholder("DD").fill(pad(date.getDate()));
  await group.getByPlaceholder("MM").first().fill(pad(date.getMonth() + 1));
  await group.getByPlaceholder("YYYY").fill(String(date.getFullYear()));
  await group.getByPlaceholder("HH").fill(pad(date.getHours()));
  // The minute input shares the "MM" placeholder with the month field; it is
  // the second "MM" within the picker (after the month field).
  await group.getByPlaceholder("MM").last().fill(pad(date.getMinutes()));
}

test.describe("maintenance windows", () => {
  test("creates the prerequisite system via the catalog UI", async ({
    page,
  }) => {
    await page.goto("/catalog/config", { waitUntil: "commit" });

    await expect(
      page.getByRole("heading", { name: "Catalog Management" }),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Add your first system" }).click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Create System" }),
    ).toBeVisible();

    await dialog.getByLabel("Name").fill(SYSTEM_NAME);
    await dialog.getByRole("button", { name: "Create System" }).click();

    await expect(page.getByText("System created successfully")).toBeVisible();
    // Scope to the desktop table: the ResponsiveTable's display:none
    // MobileCardList duplicates the name, which would trip strict mode.
    await expect(page.getByRole("table").getByText(SYSTEM_NAME)).toBeVisible();
  });

  test("resolves the created system's id from the catalog browse row", async ({
    page,
  }) => {
    await page.goto("/catalog/", { waitUntil: "commit" });

    // Systems live inside collapsible group sections (e.g. the synthetic
    // "Ungrouped" group). Expand the group whose header shows the lone system
    // so its row link is mounted, then resolve the id from the link href.
    const groupHeader = page.getByRole("button", { name: /1 system$/ });
    await expect(groupHeader).toBeVisible({ timeout: 30_000 });
    if ((await groupHeader.getAttribute("aria-expanded")) !== "true") {
      await groupHeader.click();
    }

    const systemLink = page.getByRole("link").filter({ hasText: SYSTEM_NAME });
    await expect(systemLink).toBeVisible({ timeout: 30_000 });

    const href = await systemLink.getAttribute("href");
    expect(href).toBeTruthy();
    const match = href?.match(/\/catalog\/system\/([^/?#]+)/);
    expect(match?.[1]).toBeTruthy();
    systemId = match?.[1] ?? "";
    expect(systemId).not.toBe("");
  });

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

  test("validates required fields and end-before-start in the editor", async ({
    page,
  }) => {
    await page.goto("/maintenance/config", { waitUntil: "commit" });

    await expect(
      page.getByRole("heading", { name: "Planned Maintenances" }),
    ).toBeVisible({ timeout: 30_000 });

    // Open the editor from the empty-state action.
    await page.getByRole("button", { name: "Schedule maintenance" }).click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Create Maintenance" }),
    ).toBeVisible();

    // 1. Title required: submit with everything blank.
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("Title is required")).toBeVisible();

    // 2. System required: provide a title but pick no system.
    await dialog.getByLabel("Title").fill(WINDOW_TITLE);
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(
      page.getByText("At least one system must be selected"),
    ).toBeVisible();

    // 3. End-before-start: pick the system, then set end earlier than start.
    await dialog
      .getByText(SYSTEM_NAME, { exact: true })
      .click();
    await expect(dialog.getByText("1 system(s) selected")).toBeVisible();

    const start = new Date(Date.now() + 60 * 60 * 1000);
    const endBeforeStart = new Date(Date.now() - 60 * 60 * 1000);
    await fillDateTime({ page, label: "Start Date & Time", date: start });
    await fillDateTime({ page, label: "End Date & Time", date: endBeforeStart });

    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(
      page.getByText("End date must be after start date"),
    ).toBeVisible();

    // Editor stays open after a validation failure.
    await expect(
      dialog.getByRole("heading", { name: "Create Maintenance" }),
    ).toBeVisible();

    // The form is dirty (title, system and dates set), so Cancel opens the
    // discard-confirm modal instead of closing immediately. Confirm the discard
    // (modal title "Discard changes?", confirm button "Discard"), scoping to the
    // discard dialog to avoid the two-dialog strict-mode ambiguity.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    const discard = page.getByRole("dialog", { name: "Discard changes?" });
    await expect(discard).toBeVisible();
    await discard.getByRole("button", { name: "Discard" }).click();
    await expect(
      page.getByRole("dialog", { name: "Create Maintenance" }),
    ).toBeHidden();
  });

  test("creates a maintenance window and lists it", async ({ page }) => {
    await page.goto("/maintenance/config", { waitUntil: "commit" });

    await expect(
      page.getByRole("heading", { name: "Planned Maintenances" }),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Create Maintenance" }).click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Create Maintenance" }),
    ).toBeVisible();

    await dialog.getByLabel("Title").fill(WINDOW_TITLE);
    await dialog.getByLabel("Description").fill(WINDOW_DESCRIPTION);
    await dialog.getByText(SYSTEM_NAME, { exact: true }).click();
    await expect(dialog.getByText("1 system(s) selected")).toBeVisible();

    const start = new Date(Date.now() + 60 * 60 * 1000);
    const end = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await fillDateTime({ page, label: "Start Date & Time", date: start });
    await fillDateTime({ page, label: "End Date & Time", date: end });

    await dialog.getByRole("button", { name: "Create" }).click();

    await expect(page.getByText("Maintenance created")).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "Create Maintenance" }),
    ).toBeHidden();

    // The new window shows in the list with its title and system.
    const row = page.getByRole("row", { name: new RegExp(WINDOW_TITLE) });
    await expect(row).toBeVisible();
    await expect(row).toContainText(SYSTEM_NAME);
    await expect(row.getByText("Scheduled")).toBeVisible();
  });

  test("opens the detail page from the system history", async ({ page }) => {
    expect(systemId).not.toBe("");

    await page.goto(`/maintenance/system/${systemId}/history`, {
      waitUntil: "commit",
    });

    await expect(
      page.getByRole("heading", {
        name: new RegExp(`Maintenance History: ${SYSTEM_NAME}`),
      }),
    ).toBeVisible({ timeout: 30_000 });

    const row = page.getByRole("row", { name: new RegExp(WINDOW_TITLE) });
    await expect(row).toBeVisible();
    await row.click();

    // Lands on the detail page for this maintenance window.
    await expect(page).toHaveURL(/\/maintenance\/[^/]+(\?|$)/);
    await expect(
      page.getByRole("heading", { name: WINDOW_TITLE }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Maintenance Details" }),
    ).toBeVisible();
    await expect(page.getByText(WINDOW_DESCRIPTION)).toBeVisible();
    // The affected system is rendered as a clickable badge.
    await expect(page.getByText(SYSTEM_NAME)).toBeVisible();
  });

  test("edits an existing maintenance window", async ({ page }) => {
    await page.goto("/maintenance/config", { waitUntil: "commit" });

    await expect(
      page.getByRole("heading", { name: "Planned Maintenances" }),
    ).toBeVisible({ timeout: 30_000 });

    const row = page.getByRole("row", { name: new RegExp(WINDOW_TITLE) });
    await expect(row).toBeVisible();
    // The edit action is the first ghost button in the row's Actions cell.
    await row.getByRole("button").first().click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Edit Maintenance" }),
    ).toBeVisible();

    const titleInput = dialog.getByLabel("Title");
    await expect(titleInput).toHaveValue(WINDOW_TITLE);
    await titleInput.fill(WINDOW_TITLE_EDITED);

    await dialog.getByRole("button", { name: "Update", exact: true }).click();

    await expect(page.getByText("Maintenance updated")).toBeVisible();
    await expect(
      page.getByRole("row", { name: WINDOW_TITLE_EDITED }),
    ).toBeVisible();
  });

  test("deletes a maintenance window with confirmation", async ({ page }) => {
    await page.goto("/maintenance/config", { waitUntil: "commit" });

    await expect(
      page.getByRole("heading", { name: "Planned Maintenances" }),
    ).toBeVisible({ timeout: 30_000 });

    const row = page.getByRole("row", { name: WINDOW_TITLE_EDITED });
    await expect(row).toBeVisible();
    // The delete action is the last ghost button in the row's Actions cell.
    await row.getByRole("button").last().click();

    const confirm = page.getByRole("dialog", { name: "Delete Maintenance" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Delete" }).click();

    await expect(page.getByText("Maintenance deleted")).toBeVisible();

    // Back to the empty state once the only window is gone.
    await expect(page.getByText("No planned maintenances")).toBeVisible();
    await expect(
      page.getByRole("row", { name: WINDOW_TITLE_EDITED }),
    ).toBeHidden();
  });
});
