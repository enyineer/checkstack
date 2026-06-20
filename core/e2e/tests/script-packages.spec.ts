import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Authenticated E2E for the Script Packages admin area (run as admin).
 *
 * Two settings pages, both gated on dedicated admin permissions:
 *  - `/script-packages/` (nav "Script Packages") - the allowlist + install
 *    state + advanced registry/storage/audit config. Gated on
 *    `script-packages.manage`.
 *  - `/script-packages/sandbox` (nav "Script Sandbox") - the single global
 *    script-sandbox policy editor. Gated on `script-sandbox.manage`.
 *
 * Scope deliberately avoids the "Add package" happy path: that flow proxies a
 * live npm registry search + version resolution and kicks off a real install,
 * none of which is deterministic in the e2e environment. Instead it covers the
 * deterministic, high-value surface: page rendering, the empty allowlist state,
 * the purely client-side pinned-version validation (mirrors the backend
 * `PackageVersionSchema`), the sandbox editor's key controls, and a sandbox
 * policy save round-trip.
 *
 * One fresh, empty DB is shared across this file, so it runs serially and the
 * empty-state assertions run before anything is mutated.
 */
test.describe.configure({ mode: "serial" });

// Unique per run so reruns against a (normally fresh) DB never clash.
const RUN_ID = Date.now();

const NAV_TIMEOUT = 30_000;

test.describe("Script Packages settings", () => {
  test("renders with the install-state card and an empty allowlist", async ({
    page,
  }) => {
    await page.goto("/script-packages/", { timeout: NAV_TIMEOUT });

    // PageLayout renders the page title as an <h2>. The title ("Script
    // packages") differs from the nav label ("Script Packages").
    await expect(
      page.getByRole("heading", { name: "Script packages", level: 2 }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });

    // The install-state card is always present.
    await expect(
      page.getByRole("heading", { name: "Install state" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Install now" }),
    ).toBeVisible();

    // The allowlist card with its fresh-install empty state.
    await expect(
      page.getByRole("heading", { name: "Allowed packages" }),
    ).toBeVisible();
    await expect(
      page.getByText("No packages yet. Add pinned, lightweight pure-JS packages."),
    ).toBeVisible();

    // The vulnerability-audit card shows the clean baseline on a fresh tree.
    await expect(
      page.getByRole("heading", { name: "Vulnerability audit" }),
    ).toBeVisible();
    await expect(
      page.getByText("No known vulnerabilities in the installed tree."),
    ).toBeVisible();
  });

  test("Add is disabled until a name and a valid pinned version are present", async ({
    page,
  }) => {
    await page.goto("/script-packages/", { timeout: NAV_TIMEOUT });

    const addButton = page.getByRole("button", { name: "Add", exact: true });
    await expect(addButton).toBeVisible({ timeout: NAV_TIMEOUT });
    // Both name and a valid pinned version are required: empty -> disabled.
    await expect(addButton).toBeDisabled();

    // A name alone keeps it disabled (version still missing). Use a short name
    // (< 2 chars) so the backend-proxied search popover never opens.
    await page.getByLabel("Package").fill("a");
    await expect(addButton).toBeDisabled();

    // A range/non-exact version is rejected inline (mirrors PackageVersionSchema),
    // and the inline rule text is surfaced next to the Add button.
    await page.getByLabel("Version").fill("^1.0.0");
    await expect(
      page.getByText("Version must be exact (e.g. 4.17.21), not a range"),
    ).toBeVisible();
    await expect(addButton).toBeDisabled();

    // An exact semver clears the inline error and enables Add.
    await page.getByLabel("Version").fill("1.0.0");
    await expect(
      page.getByText("Version must be exact (e.g. 4.17.21), not a range"),
    ).toHaveCount(0);
    await expect(addButton).toBeEnabled();
  });

  test("the Advanced section exposes the registry-URL config", async ({
    page,
  }) => {
    await page.goto("/script-packages/", { timeout: NAV_TIMEOUT });

    // The Advanced card holds a collapsed accordion; open "Registry & storage".
    await expect(
      page.getByRole("heading", { name: "Advanced" }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });
    await page
      .getByRole("button", { name: "Registry & storage" })
      .click();

    // The registry-URL field is revealed and pre-seeded from the resolved
    // config (the default registry). Saving requires a non-empty URL.
    const registryUrl = page.getByLabel("Registry URL");
    await expect(registryUrl).toBeVisible();
    await expect(registryUrl).not.toHaveValue("");

    const saveRegistry = page.getByRole("button", { name: "Save registry" });
    await expect(saveRegistry).toBeEnabled();
    await registryUrl.fill("");
    await expect(saveRegistry).toBeDisabled();
  });
});

test.describe("Script Sandbox settings", () => {
  test("renders the global policy editor with its key controls", async ({
    page,
  }) => {
    await page.goto("/script-packages/sandbox", { timeout: NAV_TIMEOUT });

    // PageLayout renders the page title ("Script sandbox") as an <h2>.
    await expect(
      page.getByRole("heading", { name: "Script sandbox", level: 2 }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });

    // The four policy section cards.
    await expect(
      page.getByRole("heading", { name: "Global policy" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Network egress" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Filesystem & privilege" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Resource caps" }),
    ).toBeVisible();

    // The sandbox-enabled switch and the save action are present.
    await expect(
      page.getByRole("switch", { name: "Sandbox enabled" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save policy" }),
    ).toBeVisible();
  });

  test("switching network mode to allowlist reveals the destinations field", async ({
    page,
  }) => {
    await page.goto("/script-packages/sandbox", { timeout: NAV_TIMEOUT });

    // The allowlist textarea is only rendered when mode === "allowlist".
    const allowList = page.getByLabel(
      "Allowed destinations (one IP / CIDR per line)",
    );
    await expect(allowList).toHaveCount(0);

    // The Network egress "Mode" select trigger carries id="network-mode".
    await page.locator("#network-mode").click();
    await page
      .getByRole("option", { name: "Allowlist (only listed destinations)" })
      .click();

    // The destinations textarea now appears.
    await expect(allowList).toBeVisible();
  });

  test("saving the policy surfaces the success confirmation", async ({
    page,
  }) => {
    await page.goto("/script-packages/sandbox", { timeout: NAV_TIMEOUT });

    await expect(
      page.getByRole("heading", { name: "Script sandbox", level: 2 }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });

    // Set a benign, valid resource cap so the save is a real round-trip and the
    // value is unique per run (avoids a no-op being indistinguishable).
    const cpu = page.getByLabel("CPU seconds");
    await cpu.fill(String(10 + (RUN_ID % 50)));

    await page.getByRole("button", { name: "Save policy" }).click();

    // The success Alert confirms the cluster-wide policy was persisted.
    await expect(
      page.getByRole("heading", { name: "Saved" }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(
      page.getByText(/global script-sandbox policy was updated/i),
    ).toBeVisible();
  });
});
