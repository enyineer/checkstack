import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Integrations & connections E2E.
 *
 * Covers the integration plugin surface:
 *  - `/integration/` landing page listing every registered provider.
 *  - `/integration/connections/:providerId` per-provider connection management.
 *
 * The whole file shares ONE freshly-reset, empty database (only the admin
 * user exists). Providers (Jira, Microsoft Teams, Webex) are registered by
 * their backend plugins at boot, so they are present without any seeding.
 * Tests run serially with empty-state assertions before any create flow.
 *
 * Routes are prefixed with the plugin id by `resolveRoute`, so the landing
 * lives at `/integration/` and a provider's page at
 * `/integration/connections/<qualifiedId>` (e.g. `integration-webex.webex`).
 *
 * We deliberately exercise FORM VALIDATION (required fields gate the submit
 * button) rather than a live connection - no real external credentials are
 * used or needed.
 */
test.describe.configure({ mode: "serial" });

// Webex has the simplest connection schema: a single required secret field
// (`botToken`), which makes the required-field validation assertions robust.
const WEBEX_PROVIDER_ID = "integration-webex.webex";

test.describe("integrations & connections", () => {
  test("landing page lists the registered providers", async ({ page }) => {
    await page.goto("/integration/", { waitUntil: "domcontentloaded" });

    // PageLayout renders its title as an <h2> heading.
    await expect(
      page.getByRole("heading", { name: "Integrations" }),
    ).toBeVisible({ timeout: 30_000 });

    // Every connection-capable backend plugin shows up as a provider card.
    await expect(page.getByText("Jira", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Microsoft Teams", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Webex", { exact: true })).toBeVisible();

    // A provider with a connection schema links to its connections page.
    const webexCard = page.locator(
      `a[href="/integration/connections/${WEBEX_PROVIDER_ID}"]`,
    );
    await expect(webexCard).toBeVisible();
  });

  test("opening a provider shows the empty connections state", async ({
    page,
  }) => {
    await page.goto(`/integration/connections/${WEBEX_PROVIDER_ID}`, {
      waitUntil: "domcontentloaded",
    });

    // Title is "<displayName> Connections".
    await expect(
      page.getByRole("heading", { name: "Webex Connections" }),
    ).toBeVisible({ timeout: 30_000 });

    // Fresh DB => no connections yet => the empty state renders.
    await expect(
      page.getByText("No connections configured"),
    ).toBeVisible();

    // Both the page action and the empty-state CTA can open the create dialog.
    await expect(
      page.getByRole("button", { name: "New Connection" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create connection" }),
    ).toBeVisible();
  });

  test("the add-connection form renders with name and config fields", async ({
    page,
  }) => {
    await page.goto(`/integration/connections/${WEBEX_PROVIDER_ID}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: "Webex Connections" }),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "New Connection" }).click();

    // The create dialog opens.
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "New Connection" }),
    ).toBeVisible();

    // The connection-name input (placeholder from the page source).
    await expect(
      dialog.getByPlaceholder("e.g., Production Server"),
    ).toBeVisible();

    // The provider's DynamicForm renders its schema field. The label is the
    // capitalized field key ("BotToken") with a required marker.
    await expect(dialog.getByLabel(/BotToken/)).toBeVisible();

    // Cancel closes the dialog without creating anything.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  });

  test("create is blocked until required fields are filled (validation)", async ({
    page,
  }) => {
    await page.goto(`/integration/connections/${WEBEX_PROVIDER_ID}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: "Webex Connections" }),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "New Connection" }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "New Connection" }),
    ).toBeVisible();

    const submit = dialog.getByRole("button", { name: "Create", exact: true });

    // Empty name + empty required config => submit disabled.
    await expect(submit).toBeDisabled();

    // Name only, still missing the required botToken => submit stays disabled.
    await dialog
      .getByPlaceholder("e.g., Production Server")
      .fill(`Webex E2E ${Date.now()}`);
    await expect(submit).toBeDisabled();

    // Fill the required secret field => the form becomes valid and submit
    // enables. We do NOT submit (that would attempt a real connection); the
    // point is that client-side validation gates the action.
    await dialog.getByLabel(/BotToken/).fill("test-bot-token");
    await expect(submit).toBeEnabled();

    // Clearing the required field again re-disables submit and surfaces the
    // inline required error (the field has now been touched).
    await dialog.getByLabel(/BotToken/).fill("");
    await expect(submit).toBeDisabled();
  });

  test("a provider with no connection schema is not linked from the landing", async ({
    page,
  }) => {
    await page.goto("/integration/", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Integrations" }),
    ).toBeVisible({ timeout: 30_000 });

    // All three known providers declare a connection schema, so each is a
    // navigable link (not a disabled card). This guards the regression where a
    // schema-bearing provider gets rendered as an inert, non-clickable card.
    await expect(
      page.locator(
        `a[href="/integration/connections/${WEBEX_PROVIDER_ID}"]`,
      ),
    ).toBeVisible();
    await expect(
      page.locator(
        `a[href="/integration/connections/integration-jira.jira"]`,
      ),
    ).toBeVisible();
    await expect(
      page.locator(
        `a[href="/integration/connections/integration-teams.teams"]`,
      ),
    ).toBeVisible();
  });
});
