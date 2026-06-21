import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Authenticated E2E for the admin Secrets page (Settings -> Secrets,
 * route `/secrets/`).
 *
 * Boot-once variant: the backend boots and the DB is reset ONCE, then all
 * `data-isolated specs` files run in PARALLEL against that single shared DB.
 * The DB is therefore non-empty and shared, so this file is fully
 * data-isolated: every entity it creates is namespaced with a unique-per-run
 * suffix (`NS`) so parallel specs never collide, and no test asserts on global
 * table state (no empty-state, no global counts). Tests within this file still
 * run serially (the create -> rotate -> delete chain).
 *
 * Hard security invariant under test: secret VALUES are write-only. The
 * create/rotate forms accept a value but no endpoint ever returns one, so
 * the list shows only the name + a `hasValue` badge and the entered value
 * must never appear back in the page.
 */
test.describe.configure({ mode: "serial" });

// Unique per run so parallel specs sharing one DB never collide.
const NS = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
const SECRET_NAME = `jira_token-${NS}`;
const SECRET_VALUE = `s3cr3t-value-${NS}`;
const ROTATED_VALUE = `rotated-value-${NS}`;

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
  test("disables the create button until name and value are provided", async ({
    page,
  }) => {
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

    // Still exactly one row for THIS namespaced name (upsert, not duplicate).
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

    // The specific namespaced row is gone. Scoped to our own secret only -
    // the shared DB may still hold rows created by other parallel specs, so
    // we never assert a global empty state.
    await expect(secretRow(page, SECRET_NAME)).toHaveCount(0);
  });
});
