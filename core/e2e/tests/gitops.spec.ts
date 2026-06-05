import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * GitOps & kind registry. Against a fresh, empty DB there are no Git providers
 * configured, so the providers page must render its onboarding empty state. The
 * kind registry lists the entity kinds plugins register during startup. These
 * specs exercise the read-only surfaces (no mutations), so a single shared DB is
 * fine; we still run serial and assert empty-state first.
 */
test.describe.configure({ mode: "serial" });

test.describe("GitOps & kind registry", () => {
  test("providers page renders with the empty 'no providers' state", async ({
    page,
  }) => {
    await page.goto("/gitops/");

    // PageLayout renders the title as a heading.
    await expect(
      page.getByRole("heading", { name: "GitOps" }),
    ).toBeVisible({ timeout: 15_000 });

    // The Providers tab is active by default and shows the Git Providers card.
    await expect(
      page.getByRole("heading", { name: "Git Providers" }),
    ).toBeVisible();

    // Fresh DB => no providers => the onboarding empty state.
    await expect(page.getByText("No providers configured")).toBeVisible();
    await expect(
      page.getByText(
        /keep your Checkstack infrastructure .* in a Git repository/i,
      ),
    ).toBeVisible();

    // Must not be the catch-all 404.
    await expect(page.locator("body")).not.toContainText("Route not found");
  });

  test("admin sees the 'Add Git provider' onboarding action", async ({
    page,
  }) => {
    await page.goto("/gitops/");

    await expect(
      page.getByRole("heading", { name: "GitOps" }),
    ).toBeVisible({ timeout: 15_000 });

    // The empty state surfaces a primary CTA for admins (canManage).
    await expect(
      page.getByRole("button", { name: "Add Git provider" }),
    ).toBeVisible();
  });

  test("providers page exposes Secrets and Sync Status tabs", async ({
    page,
  }) => {
    await page.goto("/gitops/");

    await expect(
      page.getByRole("heading", { name: "GitOps" }),
    ).toBeVisible({ timeout: 15_000 });

    // The three tabs from the GitOps page.
    await expect(page.getByRole("tab", { name: "Providers" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Secrets" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Sync Status" })).toBeVisible();
  });

  test("kind registry page lists registered entity kinds", async ({ page }) => {
    await page.goto("/gitops/kinds");

    await expect(
      page.getByRole("heading", { name: "Entity Kind Registry" }),
    ).toBeVisible({ timeout: 15_000 });

    await expect(
      page.getByText(
        /Browse registered entity kinds, their spec schemas, and extensions/i,
      ),
    ).toBeVisible();

    // Plugins register kinds during startup, so the registry must NOT show the
    // "no entity kinds are registered" empty state, and must NOT 404. At least
    // one kind card (e.g. the catalog System kind) is rendered.
    await expect(
      page.getByText(/No entity kinds are registered/i),
    ).toHaveCount(0);
    await expect(
      page.getByText(/Error Loading Kind Registry/i),
    ).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("Route not found");

    // Kind cards render their kind name as a card title; at least one is visible.
    await expect(
      page.getByText(/Entity kind with \d+ base properties/).first(),
    ).toBeVisible();
  });

  test("a kind card expands to reveal its YAML example", async ({ page }) => {
    await page.goto("/gitops/kinds");

    await expect(
      page.getByRole("heading", { name: "Entity Kind Registry" }),
    ).toBeVisible({ timeout: 15_000 });

    // Expand the first kind card by clicking its description header.
    const firstCardHeader = page
      .getByText(/Entity kind with \d+ base properties/)
      .first();
    await firstCardHeader.click();

    // The expanded card shows the YAML example section heading.
    await expect(
      page.getByRole("heading", { name: "YAML Example" }),
    ).toBeVisible();
  });
});
