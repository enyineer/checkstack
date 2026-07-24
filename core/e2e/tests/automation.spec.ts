import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Authenticated E2E coverage for the Automations area.
 *
 * Boot-once variant: the backend boots and the DB is reset ONCE, then all
 * boot-once specs run in PARALLEL against that single shared DB. The DB is
 * therefore non-empty and shared, so this file is fully data-isolated: every
 * entity it creates is namespaced with a unique-per-run suffix (`NS`) so
 * parallel specs never collide, and no test asserts on global table state (no
 * "No automations yet" empty-state, no global counts). Tests within this file
 * still run serially (the create -> toggle -> round-trip -> delete chain).
 *
 * Creating an automation requires a "Run as" service account. The create test
 * therefore provisions one via the Applications admin (auth settings), which is
 * the documented prerequisite for a saveable automation. Every later test
 * depends on the automation created in `create a new automation` running first.
 */
test.describe.configure({ mode: "serial" });

// Unique per run so parallel specs sharing one DB never collide.
const NS = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
const SERVICE_ACCOUNT_NAME = `Automation Runner-${NS}`;
const AUTOMATION_NAME = `E2E Automation-${NS}`;

/**
 * Provision an external application (service account) the automation editor's
 * "Run as" picker can bind. A brand-new install has none, and saving an
 * automation without one is blocked by the editor.
 */
async function createServiceAccount({
  page,
  name,
}: {
  page: import("@playwright/test").Page;
  name: string;
}): Promise<void> {
  await page.goto("/auth/settings?tab=applications");
  await expect(
    page.getByRole("heading", { name: "External Applications" }),
  ).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Create Application" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Create Application")).toBeVisible();
  await dialog.getByPlaceholder("My Application").fill(name);
  // The dialog's confirm button is the only "Create" (the page's opener button
  // reads "Create Application").
  await dialog.getByRole("button", { name: "Create", exact: true }).click();

  // On success the one-time secret dialog appears; dismiss it.
  await expect(
    page.getByRole("button", { name: "Done" }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Done" }).click();

  // The application now shows in the table - proof it's persisted and bindable.
  // Scope to the desktop table: the ResponsiveTable's display:none
  // MobileCardList duplicates the name, which would trip strict mode.
  await expect(page.getByRole("table").getByText(name)).toBeVisible();
}

test.describe("automations", () => {
  test("create page blocks save without a trigger", async ({ page }) => {
    // `/automation/new` is the template picker; the blank editor lives at
    // `/automation/new/blank`. Deep-link straight to the editor under test.
    await page.goto("/automation/new/blank");

    await expect(
      page.getByRole("heading", { name: "New automation" }),
    ).toBeVisible({ timeout: 20_000 });

    const saveButton = page.getByRole("button", { name: "Save" });
    // With no name AND no trigger, save must be disabled (name is required and
    // the definition validator rejects an empty triggers array).
    await expect(saveButton).toBeDisabled();

    // Filling a name alone is not enough — the missing trigger still blocks it.
    await page.getByLabel("Name").fill(`No Trigger-${NS}`);
    await expect(saveButton).toBeDisabled();

    // The triggers section spells out the requirement.
    await expect(
      page.getByText("An automation needs at least one trigger."),
    ).toBeVisible();
  });

  test("create a new automation with a trigger and an action", async ({
    page,
  }) => {
    // Prerequisite: a bindable service account for the "Run as" picker.
    await createServiceAccount({ page, name: SERVICE_ACCOUNT_NAME });

    // `/automation/new` is the template picker; the blank editor lives at
    // `/automation/new/blank`. Deep-link straight to the editor under test.
    await page.goto("/automation/new/blank");
    await expect(
      page.getByRole("heading", { name: "New automation" }),
    ).toBeVisible({ timeout: 20_000 });

    // Name.
    await page.getByLabel("Name").fill(AUTOMATION_NAME);

    // Run as (Service Account) — pick the one we just created.
    await page.getByLabel("Run as (Service Account)").click();
    await page
      .getByRole("option", { name: SERVICE_ACCOUNT_NAME })
      .click();

    // Add a trigger via the Add trigger picker.
    await page.getByRole("button", { name: "Add trigger" }).click();
    const triggerPicker = page.getByRole("dialog");
    await expect(triggerPicker.getByText("Add trigger")).toBeVisible();
    await triggerPicker.getByText("Interval", { exact: true }).click();

    // The trigger card appears. Open its sheet to fill the required interval.
    const triggerCard = page.getByRole("button", { name: /Interval/ });
    await expect(triggerCard.first()).toBeVisible();
    await triggerCard.first().click();

    // Trigger configuration form (DynamicForm) renders the required field.
    const intervalField = page.getByLabel("IntervalSeconds");
    await expect(intervalField).toBeVisible({ timeout: 15_000 });
    await intervalField.fill("60");
    // Close the trigger sheet.
    await page.keyboard.press("Escape");

    // Add an action: a "Delay" building block (self-contained, no provider
    // config needed) from the Blocks tab.
    await page.getByRole("button", { name: "Add step" }).click();
    const actionDialog = page.getByRole("dialog");
    await expect(actionDialog.getByText("Add action")).toBeVisible();
    await actionDialog.getByRole("tab", { name: "Blocks" }).click();
    await actionDialog.getByText("Delay", { exact: true }).click();

    // The action card is present.
    await expect(
      page.getByRole("button", { name: /Delay/ }).first(),
    ).toBeVisible();

    // Save. Validation must pass, so the button becomes enabled.
    const saveButton = page.getByRole("button", { name: "Save" });
    await expect(saveButton).toBeEnabled({ timeout: 15_000 });
    await saveButton.click();

    // Success: a toast confirms creation and we land on the edit page (the
    // heading becomes the automation name).
    await expect(page.getByText(`Created ${AUTOMATION_NAME}`)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).toHaveURL(/\/automation\/[^/]+$/);
    await expect(
      page.getByRole("heading", { name: AUTOMATION_NAME }),
    ).toBeVisible();
  });

  test("the new automation appears in the list", async ({ page }) => {
    await page.goto("/automation/");

    await expect(
      page.getByRole("heading", { name: "Automations", exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    // Scope to OUR namespaced automation only - the shared DB may hold rows
    // created by other parallel specs, so we never assert a global empty state.
    // Scope to the desktop table: the ResponsiveTable's display:none
    // MobileCardList duplicates the name, which would trip strict mode.
    await expect(
      page.getByRole("table").getByText(AUTOMATION_NAME),
    ).toBeVisible();
    // The trigger badge surfaces the wired-up event id, scoped to our row.
    await expect(
      page
        .getByRole("row")
        .filter({ hasText: AUTOMATION_NAME })
        .getByText("automation.interval"),
    ).toBeVisible();
  });

  test("toggle enable/disable from the list", async ({ page }) => {
    await page.goto("/automation/");
    const row = page
      .getByRole("row")
      .filter({ hasText: AUTOMATION_NAME });
    await expect(row).toBeVisible({ timeout: 20_000 });

    // Created enabled, so the toggle offers to disable it.
    const disableToggle = row.getByRole("switch", {
      name: "Disable automation",
    });
    await expect(disableToggle).toBeVisible();
    await expect(disableToggle).toBeChecked();
    await disableToggle.click();

    // The success toast for this toggle is intentionally suppressed (optimistic
    // update - the switch flip is the feedback), so assert the switch STATE
    // flips instead. The row now offers to enable it again, unchecked.
    const enableToggle = row.getByRole("switch", {
      name: "Enable automation",
    });
    await expect(enableToggle).toBeVisible({ timeout: 15_000 });
    await expect(enableToggle).not.toBeChecked();
    await enableToggle.click();
    // Flips back to the disable affordance, checked.
    await expect(disableToggle).toBeVisible({ timeout: 15_000 });
    await expect(disableToggle).toBeChecked();
  });

  test("Visual ↔ YAML round-trips without data loss", async ({ page }) => {
    await page.goto("/automation/");
    await page
      .getByRole("row")
      .filter({ hasText: AUTOMATION_NAME })
      .getByText(AUTOMATION_NAME)
      .click();

    await expect(
      page.getByRole("heading", { name: AUTOMATION_NAME }),
    ).toBeVisible({ timeout: 20_000 });

    // Visual tab: trigger + action are present.
    await expect(
      page.getByRole("button", { name: /Interval/ }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Delay/ }).first(),
    ).toBeVisible();

    // Switch to YAML — the serialized definition must carry the same data.
    await page.getByRole("tab", { name: "YAML" }).click();
    // Monaco renders the document text in the DOM, so we can assert on it
    // without typing into the editor.
    await expect(page.getByText("automation.interval").first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("delay").first()).toBeVisible();
    await expect(page.getByText("intervalSeconds").first()).toBeVisible();

    // Switch back to Visual — the cards survive the round-trip (no data loss).
    await page.getByRole("tab", { name: "Visual" }).click();
    await expect(
      page.getByRole("button", { name: /Interval/ }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Delay/ }).first(),
    ).toBeVisible();
  });

  test("invalid YAML blocks switching back to Visual", async ({ page }) => {
    await page.goto("/automation/");
    await page
      .getByRole("row")
      .filter({ hasText: AUTOMATION_NAME })
      .getByText(AUTOMATION_NAME)
      .click();

    await expect(
      page.getByRole("heading", { name: AUTOMATION_NAME }),
    ).toBeVisible({ timeout: 20_000 });

    await page.getByRole("tab", { name: "YAML" }).click();
    // Wait for the editor to render the existing content before editing it.
    await expect(page.getByText("automation.interval").first()).toBeVisible({
      timeout: 15_000,
    });

    // Replace the whole document with a single line of clearly-invalid YAML.
    const editor = page.locator(".monaco-editor").first();
    await editor.click();
    const selectAll = process.platform === "darwin" ? "Meta+A" : "Control+A";
    await page.keyboard.press(selectAll);
    await page.keyboard.press("Delete");
    await page.keyboard.type(": : :");

    // Attempting to switch to Visual is refused while the YAML is unparseable.
    await page.getByRole("tab", { name: "Visual" }).click();
    await expect(
      page.getByText(/YAML is invalid/i),
    ).toBeVisible({ timeout: 15_000 });
    // We stay on the YAML tab (Visual switch was rejected).
    await expect(page.getByRole("tab", { name: "YAML" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("the runs page renders an empty state", async ({ page }) => {
    await page.goto("/automation/");
    await page
      .getByRole("row")
      .filter({ hasText: AUTOMATION_NAME })
      .getByRole("button", { name: "View runs" })
      .click();

    await expect(
      page.getByRole("heading", { name: `${AUTOMATION_NAME} - runs` }),
    ).toBeVisible({ timeout: 20_000 });
    // No runs have happened, so an empty state renders. Which one depends on
    // whether a filter is active: the unfiltered "No runs yet" or, when a facet
    // is applied, "No runs match this filter". Accept either (the test asserts
    // an empty state renders, not which), and allow the runs query to load.
    await expect(
      page.getByText(/No runs yet|No runs match this filter/),
    ).toBeVisible({ timeout: 20_000 });
    // The back-to-automation affordance is present.
    await expect(
      page.getByRole("link", { name: "Back to automation" }),
    ).toBeVisible();
  });

  test("delete an automation with confirmation", async ({ page }) => {
    await page.goto("/automation/");
    const row = page
      .getByRole("row")
      .filter({ hasText: AUTOMATION_NAME });
    await expect(row).toBeVisible({ timeout: 20_000 });

    await row.getByRole("button", { name: "Delete automation" }).click();

    // Confirmation modal.
    const confirm = page.getByRole("dialog");
    await expect(
      confirm.getByText("Delete automation?"),
    ).toBeVisible();
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();

    await expect(page.getByText("Automation deleted")).toBeVisible({
      timeout: 15_000,
    });
    // Scoped to OUR own automation only - the shared DB may still hold rows
    // created by other parallel specs, so we never assert a global empty state.
    await expect(page.getByText(AUTOMATION_NAME)).toHaveCount(0);
  });
});
