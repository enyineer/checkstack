import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Catalog EMPTY-STATE E2E (read-only). Split out of catalog.spec.ts because
 * these assertions require a GLOBALLY empty catalog, which only holds on a
 * freshly reset database. `run-all.ts` boots a fresh, migration-empty DB per
 * spec file, and this file CREATES NOTHING - so the empty state holds on every
 * attempt, including a Playwright retry (the mutating catalog.spec.ts runs in a
 * separate invocation and cannot pollute this file's DB, and a retry here just
 * re-asserts against the same still-empty DB).
 *
 * Why a separate file: kept inside the mutating, serial catalog spec these
 * failed on ANY group retry - that group re-runs from the top against a DB it
 * had already populated, so "no systems" was no longer true. Isolating the
 * read-only empty-state checks removes that whole failure mode.
 *
 * Routes (plugin-prefixed): /catalog/ (browse), /catalog/config (manage).
 */
const NAV_TIMEOUT = 30_000;

test.describe("Systems & Catalog (empty state)", () => {
  test("browse shows the empty catalog state with a link to management", async ({
    page,
  }) => {
    await page.goto("/catalog/", { timeout: NAV_TIMEOUT });

    await expect(
      page.getByRole("heading", { name: "Catalog", exact: true }),
    ).toBeVisible();

    // Onboarding empty state for a brand-new, system-less catalog.
    await expect(
      page.getByText("No systems in the catalog yet"),
    ).toBeVisible();

    // The empty state offers a CTA into catalog management.
    const addFirst = page.getByRole("link", {
      name: "Add your first system",
    });
    await expect(addFirst).toBeVisible();
    await expect(addFirst).toHaveAttribute("href", "/catalog/config");
  });

  test("management page shows empty systems and groups states", async ({
    page,
  }) => {
    await page.goto("/catalog/config", { timeout: NAV_TIMEOUT });

    await expect(
      page.getByRole("heading", { name: "Catalog Management" }),
    ).toBeVisible();

    // The Systems tab (default) starts empty with its CTA.
    await expect(page.getByText("No systems yet")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add System" }),
    ).toBeVisible();

    // The Groups tab starts empty too.
    await page.getByRole("tab", { name: "Groups" }).click();
    await expect(page.getByText("No groups yet")).toBeVisible();
  });
});
