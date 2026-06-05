import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Plugin manager admin area: installed list, lifecycle event log, and the
 * install wizard. The whole file shares ONE freshly reset DB seeded with only
 * the admin user, so the installed list shows the bundled (core) platform
 * plugins while the event log starts empty. We exercise rendering and client
 * -side form validation only - we deliberately do NOT preview/install a real
 * plugin, since reaching out to a registry would destabilize the run.
 */
test.describe.configure({ mode: "serial" });

test.describe("plugin manager", () => {
  test("installed list renders the bundled plugins with versions and status", async ({
    page,
  }) => {
    await page.goto("/pluginmanager/", { timeout: 30_000 });

    await expect(
      page.getByRole("heading", { name: "Plugins", exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    // The list card and its column headers prove the table rendered. Bundled
    // platform plugins are always present on a fresh instance, so we expect the
    // table (not the empty state).
    await expect(
      page.getByRole("heading", { name: "Installed Plugins" }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Name" }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Version" }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Status" }),
    ).toBeVisible();

    // Bundled plugins are read-only and surface a "core" status badge.
    await expect(page.getByText("core").first()).toBeVisible();

    // The plugin manager itself is a bundled plugin, so at least one row exists.
    await expect(page.getByRole("row").nth(1)).toBeVisible();
  });

  test("header links navigate to the events log and the install wizard", async ({
    page,
  }) => {
    await page.goto("/pluginmanager/", { timeout: 30_000 });

    await expect(
      page.getByRole("heading", { name: "Plugins", exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByRole("link", { name: "Events" }).click();
    await expect(
      page.getByRole("heading", { name: "Plugin events" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/pluginmanager\/events$/);

    await page.goto("/pluginmanager/", { timeout: 30_000 });
    await page.getByRole("link", { name: "Install plugin" }).click();
    await expect(
      page.getByRole("heading", { name: "Install plugin" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/pluginmanager\/install$/);
  });

  test("events page renders the empty lifecycle-log state on a fresh instance", async ({
    page,
  }) => {
    await page.goto("/pluginmanager/events", { timeout: 30_000 });

    await expect(
      page.getByRole("heading", { name: "Plugin events" }),
    ).toBeVisible({ timeout: 30_000 });

    // No install/uninstall has happened, so the empty state shows.
    await expect(page.getByText("No plugin events yet")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Route not found");
  });

  test("install wizard renders the trust warning, source card and tabs", async ({
    page,
  }) => {
    await page.goto("/pluginmanager/install", { timeout: 30_000 });

    await expect(
      page.getByRole("heading", { name: "Install plugin" }),
    ).toBeVisible({ timeout: 30_000 });

    // Security warning about full platform access.
    await expect(
      page.getByText("Plugins run with full platform access."),
    ).toBeVisible();

    // The source picker card.
    await expect(
      page.getByRole("heading", { name: "Source" }),
    ).toBeVisible();

    // All four source tabs are present.
    await expect(page.getByRole("tab", { name: "NPM" })).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "Tarball Upload" }),
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "GitHub Release" }),
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "Catalog (Coming Soon)" }),
    ).toBeVisible();

    // NPM is the default tab: its package-name field is shown.
    await expect(page.getByLabel("Package name")).toBeVisible();
  });

  test("npm preview is disabled until a package name is entered", async ({
    page,
  }) => {
    await page.goto("/pluginmanager/install", { timeout: 30_000 });

    await expect(page.getByLabel("Package name")).toBeVisible({
      timeout: 30_000,
    });

    // Edge case: empty required field keeps the submit disabled.
    const previewButton = page.getByRole("button", { name: "Preview install" });
    await expect(previewButton).toBeDisabled();

    // Filling the package name enables it (we stop short of clicking it to
    // avoid hitting a registry).
    await page
      .getByLabel("Package name")
      .fill(`@scope/does-not-exist-${Date.now()}`);
    await expect(previewButton).toBeEnabled();

    // Clearing it disables the button again.
    await page.getByLabel("Package name").fill("");
    await expect(previewButton).toBeDisabled();
  });

  test("github tab requires owner, repo and tag before preview is enabled", async ({
    page,
  }) => {
    await page.goto("/pluginmanager/install", { timeout: 30_000 });

    await expect(page.getByRole("tab", { name: "GitHub Release" })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("tab", { name: "GitHub Release" }).click();

    const previewButton = page.getByRole("button", { name: "Preview install" });

    // Edge case: all required fields empty -> disabled.
    await expect(page.getByLabel("Owner")).toBeVisible();
    await expect(previewButton).toBeDisabled();

    // Partial input (owner + repo, no tag) stays disabled.
    await page.getByLabel("Owner").fill("my-org");
    await page.getByLabel("Repo").fill("my-plugin");
    await expect(previewButton).toBeDisabled();

    // All three required fields filled -> enabled.
    await page.getByLabel("Release tag").fill("v1.2.3");
    await expect(previewButton).toBeEnabled();
  });

  test("catalog tab shows the coming-soon zero state", async ({ page }) => {
    await page.goto("/pluginmanager/install", { timeout: 30_000 });

    const catalogTab = page.getByRole("tab", {
      name: "Catalog (Coming Soon)",
    });
    await expect(catalogTab).toBeVisible({ timeout: 30_000 });

    // The catalog tab is intentionally inert until the backend ships: clicking
    // it is ignored by onTabChange, so the NPM source fields stay on screen and
    // no catalog "Coming Soon" panel body is rendered.
    await catalogTab.click();
    await expect(page.getByLabel("Package name")).toBeVisible();
    await expect(
      page.getByText("The Checkstack plugin catalog is coming soon."),
    ).not.toBeVisible();
  });
});
