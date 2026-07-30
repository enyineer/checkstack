import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Authenticated E2E for cloning catalog systems and environments.
 *
 * The clone is deliberately SHALLOW - name (suffixed), description and custom
 * fields only - so these tests assert both halves of that contract: the seeded
 * fields ARE carried over, and the dialog states plainly that memberships,
 * links, team access and health checks are not.
 *
 * Boot-once variant: the DB is shared and non-empty, so every entity is
 * namespaced (`NS`) and no test asserts on global table state. Serial, because
 * each clone depends on the record the previous test created.
 *
 * Selectors come from the real component source (`SystemsTab`,
 * `EnvironmentsTab`, `SystemEditor`, `EnvironmentEditor`, `RowAction` - whose
 * `label` becomes the button's aria-label, e.g. "Clone <name>").
 */
test.describe.configure({ mode: "serial" });

const NS = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
const SYSTEM_NAME = `Clone Source System-${NS}`;
const SYSTEM_DESCRIPTION = `Payments edge (-${NS}).`;
const FIELD_KEY = "baseUrl";
const FIELD_VALUE = `https://payments-${NS}.example.com`;
const ENV_NAME = `Clone Source Env-${NS}`;

const NAV = 30_000;

test.describe("catalog cloning", () => {
  test("creates a system with a description and a custom field", async ({
    page,
  }) => {
    await page.goto("/catalog/config", { timeout: NAV });
    await expect(
      page.getByRole("heading", { name: "Catalog Management" }),
    ).toBeVisible({ timeout: NAV });

    const addFirst = page.getByRole("button", { name: "Add your first system" });
    const addFirstVisible = await addFirst.isVisible().catch(() => false);
    await (addFirstVisible
      ? addFirst.click()
      : page.getByRole("button", { name: "Add System" }).click());

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Create System" }),
    ).toBeVisible();

    await dialog.getByLabel("Name").fill(SYSTEM_NAME);
    await dialog.getByLabel(/Description/).fill(SYSTEM_DESCRIPTION);

    // Add one custom field - the thing the reporter actually wanted carried
    // across, and the reason cloning exists.
    await dialog.getByRole("button", { name: /Add (custom )?field/i }).click();
    await dialog.getByPlaceholder(/key/i).last().fill(FIELD_KEY);
    await dialog.getByPlaceholder(/value/i).last().fill(FIELD_VALUE);

    await dialog.getByRole("button", { name: "Create System" }).click();
    await expect(dialog).toBeHidden({ timeout: NAV });
    await expect(page.getByText(SYSTEM_NAME).first()).toBeVisible({
      timeout: NAV,
    });
  });

  test("cloning a system seeds a suffixed name, the description and the fields", async ({
    page,
  }) => {
    await page.goto("/catalog/config", { timeout: NAV });
    await expect(page.getByText(SYSTEM_NAME).first()).toBeVisible({
      timeout: NAV,
    });

    await page
      .getByRole("button", { name: `Clone ${SYSTEM_NAME}` })
      .click();

    const dialog = page.getByRole("dialog");
    // A clone opens as a CREATE, titled distinctly so it cannot be mistaken for
    // editing the original.
    await expect(
      dialog.getByRole("heading", { name: "Clone System" }),
    ).toBeVisible({ timeout: NAV });

    // Suffixed so the copy cannot be confused with - or saved over - its source.
    await expect(dialog.getByLabel("Name")).toHaveValue(`${SYSTEM_NAME} (copy)`);
    await expect(dialog.getByLabel(/Description/)).toHaveValue(
      SYSTEM_DESCRIPTION,
    );
    // The custom field row round-tripped: its key and value inputs hold the
    // source's values.
    await expect(dialog.locator(`input[value="${FIELD_KEY}"]`)).toBeVisible();
    await expect(dialog.locator(`input[value="${FIELD_VALUE}"]`)).toBeVisible();

    // The dialog states what did NOT come along, so nobody assumes the copy
    // inherited the source's checks or memberships.
    await expect(dialog.getByText(/Cloned from/)).toBeVisible();
    await expect(
      dialog.getByText(/health checks are not copied/i),
    ).toBeVisible();

    await dialog.getByRole("button", { name: "Create System" }).click();
    await expect(dialog).toBeHidden({ timeout: NAV });

    // Both the original and the copy now exist, independently.
    await expect(page.getByText(SYSTEM_NAME, { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText(`${SYSTEM_NAME} (copy)`, { exact: true }).first(),
    ).toBeVisible({ timeout: NAV });
  });

  test("creates an environment, then clones it the same way", async ({
    page,
  }) => {
    await page.goto("/catalog/config", { timeout: NAV });
    await page.getByRole("tab", { name: /Environments/i }).click();

    await page
      .getByRole("button", { name: /Add (your first )?[Ee]nvironment/ })
      .first()
      .click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Create Environment" }),
    ).toBeVisible({ timeout: NAV });
    await dialog.getByLabel("Name").fill(ENV_NAME);
    await dialog.getByRole("button", { name: "Create Environment" }).click();
    await expect(dialog).toBeHidden({ timeout: NAV });

    await page.getByRole("button", { name: `Clone ${ENV_NAME}` }).click();
    await expect(
      dialog.getByRole("heading", { name: "Clone Environment" }),
    ).toBeVisible({ timeout: NAV });
    await expect(dialog.getByLabel("Name")).toHaveValue(`${ENV_NAME} (copy)`);

    await dialog.getByRole("button", { name: "Create Environment" }).click();
    await expect(dialog).toBeHidden({ timeout: NAV });
    await expect(
      page.getByText(`${ENV_NAME} (copy)`, { exact: true }).first(),
    ).toBeVisible({ timeout: NAV });
  });
});
