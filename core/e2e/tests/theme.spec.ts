import type { Page } from "@playwright/test";
import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Theme switcher (cross-cutting appearance).
 *
 * For a logged-in user the theme control lives in the user menu (the
 * `UserMenu` popover, opened from the trigger button labelled with the admin's
 * name). `ThemeToggleMenuItem` (theme-frontend) renders `ThemeModeSelector`: a
 * `role="radiogroup"` labelled "Theme" holding three `role="radio"` options -
 * Light, Dark and Auto. Auto persists `system`, which follows the OS preference
 * rather than pinning a colour.
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

/** Opens the user menu and returns the theme options inside its popover. */
async function openThemeSelector(page: Page) {
  await page.getByRole("button", { name: ADMIN_NAME }).click();
  // The desktop UserMenu renders a Radix Popover (role="dialog").
  const menu = page.getByRole("dialog");
  await expect(menu).toBeVisible({ timeout: NAV_TIMEOUT });
  const group = menu.getByRole("radiogroup", { name: "Theme" });
  await expect(group).toBeVisible();
  return {
    menu,
    group,
    light: group.getByRole("radio", { name: "Light" }),
    dark: group.getByRole("radio", { name: "Dark" }),
    auto: group.getByRole("radio", { name: "Auto" }),
  };
}

/**
 * Sets the theme THROUGH THE UI, which is the only reliable way for a signed-in
 * user.
 *
 * Seeding `localStorage` and reloading does NOT work here: `ThemeSynchronizer`
 * fetches the signed-in user's stored theme from the BACKEND on load and applies
 * it, overwriting whatever was seeded. (An earlier version of this spec seeded
 * localStorage and appeared to pass only because the backend default `system`
 * happened to resolve to the same colour.) Clicking the option writes both the
 * backend and localStorage, so the state is real and survives a reload.
 */
async function chooseTheme(page: Page, name: "Light" | "Dark" | "Auto") {
  const { group } = await openThemeSelector(page);
  await group.getByRole("radio", { name }).click();
  await expect(group.getByRole("radio", { name })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  // Close the popover so the next navigation/assertion is not covered by it.
  await page.keyboard.press("Escape");
}

test.describe("theme switcher", () => {
  test("the theme selector lives in the user menu and reflects the applied theme", async ({
    page,
  }) => {
    await page.goto("/");

    const html = page.locator("html");
    // Resolved theme is always one of the two classes once ThemeProvider runs.
    await expect(html).toHaveClass(/(?:^|\s)(?:light|dark)(?:\s|$)/, {
      timeout: NAV_TIMEOUT,
    });

    await chooseTheme(page, "Light");
    const { light, dark, auto } = await openThemeSelector(page);

    // Exactly one option is selected, and it agrees with the chosen theme.
    await expect(light).toHaveAttribute("aria-checked", "true");
    await expect(dark).toHaveAttribute("aria-checked", "false");
    await expect(auto).toHaveAttribute("aria-checked", "false");
  });

  test("choosing Dark applies the `dark` class on <html>", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");

    await chooseTheme(page, "Light");
    await expect(html).toHaveClass(/(?:^|\s)light(?:\s|$)/, {
      timeout: NAV_TIMEOUT,
    });

    const { dark } = await openThemeSelector(page);
    await dark.click();

    await expect(html).toHaveClass(/(?:^|\s)dark(?:\s|$)/, {
      timeout: NAV_TIMEOUT,
    });
    await expect(html).not.toHaveClass(/(?:^|\s)light(?:\s|$)/);
    await expect(dark).toHaveAttribute("aria-checked", "true");
  });

  test("choosing Light reverts the `dark` class", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");

    await chooseTheme(page, "Dark");
    await expect(html).toHaveClass(/(?:^|\s)dark(?:\s|$)/, {
      timeout: NAV_TIMEOUT,
    });

    const { light } = await openThemeSelector(page);
    await light.click();

    await expect(html).toHaveClass(/(?:^|\s)light(?:\s|$)/, {
      timeout: NAV_TIMEOUT,
    });
    await expect(html).not.toHaveClass(/(?:^|\s)dark(?:\s|$)/);
    await expect(light).toHaveAttribute("aria-checked", "true");
  });

  /**
   * The regression this whole feature exists for: before Auto was selectable,
   * picking Light or Dark overwrote the stored `system` preference permanently,
   * with no control able to write it back.
   */
  test("Auto is reachable again after an explicit choice, and follows the OS", async ({
    page,
  }) => {
    // Emulate a dark OS preference so `system` has an unambiguous target that
    // differs from the explicit choice we start from.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    const html = page.locator("html");

    // Start pinned to light - the state that used to be a one-way door.
    await chooseTheme(page, "Light");
    await expect(html).toHaveClass(/(?:^|\s)light(?:\s|$)/, {
      timeout: NAV_TIMEOUT,
    });

    const { auto } = await openThemeSelector(page);
    await auto.click();

    // Auto resolves against the emulated OS preference, so <html> flips to dark
    // even though no colour was chosen.
    await expect(html).toHaveClass(/(?:^|\s)dark(?:\s|$)/, {
      timeout: NAV_TIMEOUT,
    });
    await expect(auto).toHaveAttribute("aria-checked", "true");

    // The persisted value is the MODE, not the resolved colour.
    await expect
      .poll(async () =>
        page.evaluate(([key]) => localStorage.getItem(key), [
          THEME_STORAGE_KEY,
        ]),
      )
      .toBe("system");

    // Flipping the OS preference repaints without any further interaction -
    // this is what the missing matchMedia listener used to break.
    await page.emulateMedia({ colorScheme: "light" });
    await expect(html).toHaveClass(/(?:^|\s)light(?:\s|$)/, {
      timeout: NAV_TIMEOUT,
    });

    await page.emulateMedia({ colorScheme: null });
  });

  test("the chosen theme persists across reload (localStorage + backend)", async ({
    page,
  }) => {
    await page.goto("/");
    const html = page.locator("html");

    // Choose dark via the selector (writes localStorage AND the backend prefs).
    const { dark } = await openThemeSelector(page);
    await dark.click();
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
    const { light } = await openThemeSelector(page);
    await light.click();
    await expect(html).toHaveClass(/(?:^|\s)light(?:\s|$)/, {
      timeout: NAV_TIMEOUT,
    });
  });
});
