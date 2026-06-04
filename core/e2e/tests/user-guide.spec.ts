import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * In-app user guide. Guards the regression where the docs links 404'd in the
 * app: the backend serves the Astro Starlight build same-origin at
 * `/checkstack/*`. If that serving breaks (or a doc page the app links to is
 * renamed), these fail instead of users hitting a 404.
 */
test.describe("in-app user guide", () => {
  test("serves the Starlight docs at /checkstack/user-guide/ (not a 404)", async ({
    page,
  }) => {
    const res = await page.goto("/checkstack/user-guide/");
    expect(res?.status()).toBe(200);

    // The app's catch-all 404 renders "Route not found"; the real docs page
    // must NOT.
    await expect(page.locator("body")).not.toContainText("Route not found");
    // Starlight marks the document with its layout attributes - a strong signal
    // we got the real docs page, not the SPA shell.
    await expect(page.locator("html")).toHaveAttribute("data-has-sidebar");
  });

  test("a deep-linked docs page resolves in-app", async ({ page }) => {
    // The exact page the automation service-account picker links to.
    const res = await page.goto(
      "/checkstack/user-guide/concepts/teams-and-access/",
    );
    expect(res?.status()).toBe(200);
    await expect(page.locator("body")).not.toContainText("Route not found");
  });

  test("the sidebar Docs link targets the user guide", async ({ page }) => {
    await page.goto("/");
    const docsLink = page.getByRole("link", { name: "Docs" });
    await expect(docsLink).toBeVisible();
    // Opens in a new tab; assert the target rather than managing a popup (the
    // serving itself is covered above).
    await expect(docsLink).toHaveAttribute(
      "href",
      "/checkstack/user-guide/",
    );
  });

  test("an unknown /checkstack/ path returns the docs 404, not the SPA shell", async ({
    page,
  }) => {
    // The `/checkstack/*` namespace is the docs site; a missing doc must return a
    // real 404 (Starlight's 404 page), not fall through to the SPA catch-all and
    // 200 the app shell.
    const res = await page.goto("/checkstack/this-page-does-not-exist-xyz/");
    expect(res?.status()).toBe(404);
    // The SPA catch-all renders "Route not found"; the docs 404 must not.
    await expect(page.locator("body")).not.toContainText("Route not found");
  });
});
