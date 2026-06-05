import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Authenticated E2E for the admin Secrets page (Settings -> Secrets,
 * route `/secrets/`).
 *
 * Hard security invariant under test: secret VALUES are write-only. The
 * create/rotate forms accept a value but no endpoint ever returns one, so
 * the list shows only the name + a `hasValue` badge and the entered value
 * must never appear back in the page.
 *
 * One fresh, empty DB is shared across this file, so the tests run serially
 * and ordered: the empty-state assertion runs before anything is created.
 */
test.describe.configure({ mode: "serial" });

// Unique per run so reruns against a (normally fresh) DB never clash.
const RUN = Date.now();
const SECRET_NAME = `jira_token_${RUN}`;
const SECRET_VALUE = `s3cr3t-value-${RUN}`;
const ROTATED_VALUE = `rotated-value-${RUN}`;

/** The list renders each secret name inside a <code> element. */
function secretRow(page: import("@playwright/test").Page, name: string) {
  // The name lives in a <code>; the controls live in the same <li> row.
  return page.locator("li", { has: page.getByText(name, { exact: true }) });
}

/**
 * The delete control is an icon-only destructive button (no text) and is the
 * only button in the row without an accessible name; the rotate button is
 * labelled "Rotate".
 */
function deleteButton(
  page: import("@playwright/test").Page,
  name: string,
) {
  return secretRow(page, name)
    .getByRole("button")
    .filter({ hasNotText: "Rotate" });
}

test.describe("admin secrets", () => {
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

  test("disables the create button until name and value are provided", async ({
    page,
  }) => {
    await page.goto("/secrets/", { waitUntil: "domcontentloaded" });

    const addButton = page.getByRole("button", { name: "Add secret" });
    await expect(addButton).toBeVisible();
    // Required-field validation: both name AND value are required.
    await expect(addButton).toBeDisabled();

    // Name only -> still disabled.
    await page.getByLabel("Name", { exact: true }).fill(SECRET_NAME);
    await expect(addButton).toBeDisabled();

    // Value only -> still disabled.
    await page.getByLabel("Name", { exact: true }).fill("");
    await page.getByLabel("Value", { exact: true }).fill(SECRET_VALUE);
    await expect(addButton).toBeDisabled();

    // Both present -> enabled.
    await page.getByLabel("Name", { exact: true }).fill(SECRET_NAME);
    await expect(addButton).toBeEnabled();
  });

  test("creates a secret and lists it without ever exposing the value", async ({
    page,
  }) => {
    await page.goto("/secrets/", { waitUntil: "domcontentloaded" });

    await page.getByLabel("Name", { exact: true }).fill(SECRET_NAME);
    await page.getByLabel("Value", { exact: true }).fill(SECRET_VALUE);

    const valueInput = page.getByLabel("Value", { exact: true });
    // The value field is a password input - it is never rendered as plain text.
    await expect(valueInput).toHaveAttribute("type", "password");

    await page.getByRole("button", { name: "Add secret" }).click();

    // The new secret appears in the list with its name + a "set" badge.
    const row = secretRow(page, SECRET_NAME);
    await expect(row).toBeVisible();
    await expect(row.getByText("set", { exact: true })).toBeVisible();

    // The form clears after a successful create.
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Value", { exact: true })).toHaveValue("");

    // Security invariant: the secret VALUE is never displayed back anywhere.
    await expect(page.locator("body")).not.toContainText(SECRET_VALUE);
  });

  test("creating with an existing name rotates it rather than duplicating", async ({
    page,
  }) => {
    await page.goto("/secrets/", { waitUntil: "domcontentloaded" });

    // Wait for the existing secret to load.
    await expect(secretRow(page, SECRET_NAME)).toBeVisible();

    // setSecret upserts: re-submitting the same name rotates the value and
    // does NOT create a second row.
    await page.getByLabel("Name", { exact: true }).fill(SECRET_NAME);
    await page
      .getByLabel("Value", { exact: true })
      .fill(`dup-${ROTATED_VALUE}`);
    await page.getByRole("button", { name: "Add secret" }).click();

    // Form clears -> the upsert succeeded.
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("");

    // Still exactly one row for this name.
    await expect(secretRow(page, SECRET_NAME)).toHaveCount(1);

    // The rotated value is never shown.
    await expect(page.locator("body")).not.toContainText(
      `dup-${ROTATED_VALUE}`,
    );
  });

  test("rotates a secret via the dialog without revealing the value", async ({
    page,
  }) => {
    await page.goto("/secrets/", { waitUntil: "domcontentloaded" });

    const row = secretRow(page, SECRET_NAME);
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: "Rotate" }).click();

    // Rotate dialog opens, scoped to this secret.
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: `Rotate "${SECRET_NAME}"` }),
    ).toBeVisible();

    // The Rotate confirm button is disabled until a new value is entered.
    const confirmRotate = dialog.getByRole("button", {
      name: "Rotate",
      exact: true,
    });
    await expect(confirmRotate).toBeDisabled();

    const newValueInput = dialog.getByLabel("New value", { exact: true });
    await expect(newValueInput).toHaveAttribute("type", "password");
    await newValueInput.fill(ROTATED_VALUE);

    await expect(confirmRotate).toBeEnabled();
    await confirmRotate.click();

    // Dialog closes after a successful rotation.
    await expect(dialog).toBeHidden();

    // The secret is still listed (rotation keeps the same row + "set" badge).
    await expect(row).toBeVisible();
    await expect(row.getByText("set", { exact: true })).toBeVisible();

    // The rotated value never appears in the UI.
    await expect(page.locator("body")).not.toContainText(ROTATED_VALUE);
  });

  test("deletes a secret only after confirming", async ({ page }) => {
    await page.goto("/secrets/", { waitUntil: "domcontentloaded" });

    const row = secretRow(page, SECRET_NAME);
    await expect(row).toBeVisible();

    // The delete control is the destructive (icon-only) button in the row.
    await deleteButton(page, SECRET_NAME).click();

    // Confirmation modal appears.
    const confirm = page.getByRole("dialog");
    await expect(
      confirm.getByRole("heading", { name: "Delete secret" }),
    ).toBeVisible();

    // Cancel first - the secret must survive.
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toBeHidden();
    await expect(row).toBeVisible();

    // Now actually delete it.
    await deleteButton(page, SECRET_NAME).click();
    await expect(
      page.getByRole("dialog").getByRole("heading", { name: "Delete secret" }),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete", exact: true })
      .click();

    // The row is gone and we are back to the empty state.
    await expect(secretRow(page, SECRET_NAME)).toHaveCount(0);
    await expect(page.getByText("No secrets yet. Add one above.")).toBeVisible();
  });
});
