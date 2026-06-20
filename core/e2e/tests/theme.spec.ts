import type { Page } from "@playwright/test";
import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Theme / dark-mode switcher (cross-cutting appearance).
 *
 * For a logged-in user the theme control lives in the user menu (the
 * `UserMenu` popover, opened from the trigger button labelled with the admin's
 * name). `ThemeToggleMenuItem` (theme-frontend) renders a `role="switch"`
 * labelled "Toggle dark mode" whose `aria-checked` reflects the resolved theme.
 *
 * The applied signal comes from `@checkstack/ui`'s `ThemeProvider`: it
 * `classList.remove("light", "dark")` then `classList.add(resolvedTheme)` on
 * `document.documentElement`, so the live theme is the `light`/`dark` class on
 * `<html>`. The chosen theme is persisted to `localStorage["checkstack-ui-theme"]`
 * (ThemeProvider) AND to the backend (ThemeSynchronizer reads it back on load),
 * so it survives a reload.
 *
 * Runs in the authenticated `chromium` project (admin session) at the default
 * desktop viewport. No data prerequisites.
 */

test.describe.configure({ mode: "serial" });

const NAV_TIMEOUT = 30_000;

// Matches the onboarded admin created by auth.setup.ts (support/auth.ts).
const ADMIN_NAME = "E2E Admin";

// ThemeProvider's storage key (core/ui ThemeProvider `storageKey` default).
const THEME_STORAGE_KEY = "checkstack-ui-theme";

/** Opens the user menu and returns the dark-mode switch inside its popover. */
async function openThemeSwitch(page: Page) {
  await page.getByRole("button", { name: ADMIN_NAME }).click();
  // The desktop UserMenu renders a Radix Popover (role="dialog").
  const menu = page.getByRole("dialog");
  await expect(menu).toBeVisible({ timeout: NAV_TIMEOUT });
  await expect(menu.getByText("Dark Mode", { exact: true })).toBeVisible();
  const toggle = menu.getByRole("switch", { name: "Toggle dark mode" });
  await expect(toggle).toBeVisible();
  return { menu, toggle };
}

test.describe("theme / dark-mode switcher", () => {
  test("the dark-mode switch lives in the user menu and reflects the applied theme", async ({
    page,
  }) => {
    await page.goto("/");

    const html = page.locator("html");
    // Resolved theme is always one of the two classes once ThemeProvider runs.
    await expect(html).toHaveClass(/(?:^|\s)(?:light|dark)(?:\s|$)/, {
      timeout: NAV_TIMEOUT,
    });

    const { toggle } = await openThemeSwitch(page);

    // The switch's aria-checked must agree with the applied <html> class.
    const htmlClass = await html.getAttribute("class");
    const isDark = htmlClass?.includes("dark") ?? false;
    await expect(toggle).toHaveAttribute(
      "aria-checked",
      isDark ? "true" : "false",
    );
  });

  test("toggling to dark applies the `dark` class on <html>", async ({
    page,
  }) => {
    await page.goto("/");
    const html = page.locator("html");

    // Force a known starting point so the assertion is deterministic.
    await page.evaluate(
      ([key]) => {
        localStorage.setItem(key, "light");
      },
      [THEME_STORAGE_KEY],
    );
    await page.reload();
    await expect(html).toHaveClass(/(?:^|\s)light(?:\s|$)/, {
      timeout: NAV_TIMEOUT,
    });

    const { toggle } = await openThemeSwitch(page);
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    await toggle.click();

    await expect(html).toHaveClass(/(?:^|\s)dark(?:\s|$)/, {
      timeout: NAV_TIMEOUT,
    });
    await expect(html).not.toHaveClass(/(?:^|\s)light(?:\s|$)/);
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  test("toggling back to light reverts the `dark` class", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");

    // Start from dark (set by the previous serial test; force it for safety).
    await page.evaluate(
      ([key]) => {
        localStorage.setItem(key, "dark");
      },
      [THEME_STORAGE_KEY],
    );
    await page.reload();
    await expect(html).toHaveClass(/(?:^|\s)dark(?:\s|$)/, {
      timeout: NAV_TIMEOUT,
    });

    const { toggle } = await openThemeSwitch(page);
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    await toggle.click();

    await expect(html).toHaveClass(/(?:^|\s)light(?:\s|$)/, {
      timeout: NAV_TIMEOUT,
    });
    await expect(html).not.toHaveClass(/(?:^|\s)dark(?:\s|$)/);
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  test("the chosen theme persists across reload (localStorage + backend)", async ({
    page,
  }) => {
    await page.goto("/");
    const html = page.locator("html");

    // Choose dark via the switch (writes localStorage AND the backend prefs).
    const { toggle } = await openThemeSwitch(page);
    if ((await toggle.getAttribute("aria-checked")) !== "true") {
      await toggle.click();
    }
    await expect(html).toHaveClass(/(?:^|\s)dark(?:\s|$)/, {
      timeout: NAV_TIMEOUT,
    });

    // localStorage holds the explicit choice.
    await expect
      .poll(async () =>
        page.evaluate(([key]) => localStorage.getItem(key), [
          THEME_STORAGE_KEY,
        ]),
      )
      .toBe("dark");

    await page.reload();

    // After reload the dark theme is re-applied (ThemeProvider from localStorage
    // and ThemeSynchronizer from the backend both resolve to dark).
    await expect(html).toHaveClass(/(?:^|\s)dark(?:\s|$)/, {
      timeout: NAV_TIMEOUT,
    });

    // Reset to light so the suite leaves the shared session in a neutral state.
    const { toggle: toggleAfter } = await openThemeSwitch(page);
    await toggleAfter.click();
    await expect(html).toHaveClass(/(?:^|\s)light(?:\s|$)/, {
      timeout: NAV_TIMEOUT,
    });
  });
});
