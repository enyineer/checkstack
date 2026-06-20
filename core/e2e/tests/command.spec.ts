import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Command palette (global search) E2E.
 *
 * The palette is a slot-registered navbar affordance (`command.navbar.search`,
 * mounted into `NavbarCenterSlot` by command-frontend). It renders a trigger
 * button (`aria-label="Open search"`) and a Radix `Dialog` overlay holding a
 * search `<input>` with placeholder "Search commands and systems...". The
 * dialog opens via the trigger or the global ⌘K / Ctrl+K listener registered in
 * `NavbarSearch` ((metaKey || ctrlKey) && key === "k"); CI is Linux, so the
 * tests use Control+K.
 *
 * Typing debounces (300ms) and queries the backend `command.search` provider
 * aggregation. The always-present "Manage Incidents" command is contributed by
 * core incident-backend (`registerSearchProvider`, title "Manage Incidents",
 * route `/incident/config`) and is visible to the admin (it requires
 * `incident.manage`, which the wildcard admin holds). Selecting it navigates to
 * the incident config page; Escape closes the overlay.
 *
 * Runs in the authenticated `chromium` project (admin session) at the default
 * desktop viewport so the navbar trigger is mounted. No data prerequisites - the
 * exercised commands are static registrations, not DB rows.
 */

test.describe.configure({ mode: "serial" });

const NAV_TIMEOUT = 30_000;

// A command always registered by core incident-backend, visible to the admin.
const KNOWN_COMMAND = "Manage Incidents";

test.describe("command palette", () => {
  test("the navbar exposes the search trigger", async ({ page }) => {
    await page.goto("/", { timeout: NAV_TIMEOUT });

    // Wait for the app shell to be ready before asserting the slot-mounted
    // trigger - the navbar renders after the SPA boots.
    await expect(
      page.getByRole("heading", { name: "Checkstack", level: 1 }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });

    const trigger = page.getByRole("button", { name: "Open search" });
    await expect(trigger).toBeVisible();

    // The palette is closed until invoked.
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("Ctrl+K opens the palette with its search input", async ({ page }) => {
    await page.goto("/", { timeout: NAV_TIMEOUT });
    await expect(
      page.getByRole("button", { name: "Open search" }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });

    // Global shortcut registered by NavbarSearch: (metaKey||ctrlKey)+"k".
    // CI is Linux, so Control+K is the active binding.
    await page.keyboard.press("Control+k");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByPlaceholder("Search commands and systems..."),
    ).toBeVisible();
  });

  test("the trigger button opens the palette", async ({ page }) => {
    await page.goto("/", { timeout: NAV_TIMEOUT });

    const trigger = page.getByRole("button", { name: "Open search" });
    await expect(trigger).toBeVisible({ timeout: NAV_TIMEOUT });
    await trigger.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByPlaceholder("Search commands and systems..."),
    ).toBeVisible();

    // Escape closes the Radix overlay (handled by SearchDialog's onKeyDown and
    // Radix's own dismiss); the dialog leaves the DOM.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("typing a query filters to a known command", async ({ page }) => {
    await page.goto("/", { timeout: NAV_TIMEOUT });
    await expect(
      page.getByRole("button", { name: "Open search" }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });

    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Search is debounced (300ms) and hits the backend providers. Filtering by
    // a distinctive term surfaces the incident command without ambiguity.
    await dialog
      .getByPlaceholder("Search commands and systems...")
      .fill("Manage Incidents");

    // The result renders as a button with the exact command title. Scope to the
    // dialog and use an exact match so the substring/case-insensitive default
    // can't pull in unrelated prose.
    await expect(
      dialog.getByText(KNOWN_COMMAND, { exact: true }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });
  });

  test("selecting a command navigates and closes the palette", async ({
    page,
  }) => {
    await page.goto("/", { timeout: NAV_TIMEOUT });
    await expect(
      page.getByRole("button", { name: "Open search" }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });

    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog
      .getByPlaceholder("Search commands and systems...")
      .fill("Manage Incidents");

    const result = dialog.getByText(KNOWN_COMMAND, { exact: true });
    await expect(result).toBeVisible({ timeout: NAV_TIMEOUT });
    await result.click();

    // The command's route is `/incident/config` (incident-backend registration).
    // Selecting navigates there and the overlay closes.
    await expect(page).toHaveURL(/\/incident\/config$/, {
      timeout: NAV_TIMEOUT,
    });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Route not found" }),
    ).toHaveCount(0);
  });
});
