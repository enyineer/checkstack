import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Authenticated E2E coverage for the Announcements area.
 *
 * The whole file shares ONE freshly-reset, empty database (only the admin user
 * exists at start), so tests run serially and the empty-state assertions run
 * before anything is created.
 *
 * Routes: /announcement/manage (manage page). Active announcements with a
 * dashboard/both display mode also surface on the dashboard ("/").
 */
test.describe.configure({ mode: "serial" });

const MANAGE_ROUTE = "/announcement/manage";

// Unique suffix so reruns / parallel files never collide on titles.
const SUFFIX = Date.now();
const TITLE = `Planned maintenance ${SUFFIX}`;
const EDITED_TITLE = `Planned maintenance (updated) ${SUFFIX}`;
const MESSAGE = `Scheduled downtime this weekend ${SUFFIX}.`;

test.describe("announcements", () => {
  test("shows the empty state when no announcements exist", async ({
    page,
  }) => {
    await page.goto(MANAGE_ROUTE, { waitUntil: "domcontentloaded" });

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

  test("validates that title and message are required", async ({ page }) => {
    await page.goto(MANAGE_ROUTE, { waitUntil: "domcontentloaded" });

    await page
      .getByRole("button", { name: "Create your first announcement" })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Create Announcement" }),
    ).toBeVisible();

    // The Title input has the native `required` attribute, so submitting with
    // it empty must keep the dialog open (browser blocks the submit) and the
    // field stays invalid.
    const titleInput = dialog.getByLabel("Title");
    await dialog.getByRole("button", { name: "Create" }).click();

    await expect(
      dialog.getByRole("heading", { name: "Create Announcement" }),
    ).toBeVisible();
    await expect(titleInput).toHaveJSProperty("validity.valid", false);

    // Close the dialog without creating anything.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    // Still empty.
    await expect(page.getByText("No announcements yet")).toBeVisible();
  });

  test("creates an announcement and it appears in the table", async ({
    page,
  }) => {
    await page.goto(MANAGE_ROUTE, { waitUntil: "domcontentloaded" });

    await page
      .getByRole("button", { name: "Create your first announcement" })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Create Announcement" }),
    ).toBeVisible();

    await dialog.getByLabel("Title").fill(TITLE);
    await dialog.getByLabel("Message (Markdown)").fill(MESSAGE);

    await dialog.getByRole("button", { name: "Create" }).click();

    // Dialog closes on success.
    await expect(dialog).toBeHidden();

    // Empty state is gone; the row is rendered with default Info severity and
    // an Active status (default active=true, no schedule window).
    await expect(page.getByText("No announcements yet")).toBeHidden();
    await expect(page.getByRole("cell", { name: TITLE })).toBeVisible();

    const row = page.getByRole("row", { name: new RegExp(SUFFIX.toString()) });
    await expect(row.getByText("Info")).toBeVisible();
    await expect(row.getByText("Active")).toBeVisible();
  });

  test("surfaces the active announcement on the dashboard", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // The dashboard renders active dashboard/both-mode announcements as
    // compact cards under an "Announcements" section.
    const card = page.getByRole("button", { name: new RegExp(TITLE) });
    await expect(card).toBeVisible({ timeout: 30_000 });

    // Expanding the card reveals the markdown message body.
    await card.click();
    await expect(page.getByText(MESSAGE)).toBeVisible();
  });

  test("edits the announcement title", async ({ page }) => {
    await page.goto(MANAGE_ROUTE, { waitUntil: "domcontentloaded" });

    const row = page.getByRole("row", { name: new RegExp(SUFFIX.toString()) });
    await expect(row).toBeVisible({ timeout: 30_000 });

    // The first action button in the row is Edit (pencil), the second is Delete.
    await row.getByRole("button").first().click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Edit Announcement" }),
    ).toBeVisible();

    // Existing values are pre-filled.
    await expect(dialog.getByLabel("Title")).toHaveValue(TITLE);

    await dialog.getByLabel("Title").fill(EDITED_TITLE);
    await dialog.getByRole("button", { name: "Update" }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByRole("cell", { name: EDITED_TITLE })).toBeVisible();
    await expect(page.getByRole("cell", { name: TITLE, exact: true })).toBeHidden();
  });

  test("requires confirmation before deleting and removes the announcement", async ({
    page,
  }) => {
    await page.goto(MANAGE_ROUTE, { waitUntil: "domcontentloaded" });

    const row = page.getByRole("row", { name: new RegExp(SUFFIX.toString()) });
    await expect(row).toBeVisible({ timeout: 30_000 });

    // Open the delete confirmation (second action button = trash).
    await row.getByRole("button").nth(1).click();

    const confirm = page.getByRole("dialog");
    await expect(
      confirm.getByRole("heading", { name: "Delete Announcement" }),
    ).toBeVisible();
    await expect(
      confirm.getByText(
        "Are you sure you want to delete this announcement? This action cannot be undone.",
      ),
    ).toBeVisible();

    // Cancelling keeps the announcement.
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByRole("cell", { name: EDITED_TITLE })).toBeVisible();

    // Now actually delete it.
    await row.getByRole("button").nth(1).click();
    await expect(
      page.getByRole("dialog").getByRole("heading", {
        name: "Delete Announcement",
      }),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete" })
      .click();

    // Row is gone and the empty state returns (this was the only announcement).
    await expect(page.getByRole("cell", { name: EDITED_TITLE })).toBeHidden();
    await expect(page.getByText("No announcements yet")).toBeVisible();
  });
});
