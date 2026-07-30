import type { Theme } from "@checkstack/ui";

/**
 * The three theme modes, in the order they are presented.
 *
 * `system` is labelled "Auto" in the UI: users think of it as "match my
 * device", not as a third colour. The stored value stays `system` because that
 * is what the backend and `ThemeProvider` have always persisted - renaming it
 * would orphan every existing preference.
 */
export const THEME_MODES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Auto" },
] as const satisfies ReadonlyArray<{ value: Theme; label: string }>;

export type ThemeModeOption = (typeof THEME_MODES)[number];

/** The presentation for one mode, for a label or an icon button. */
export function getThemeModeOption({ theme }: { theme: Theme }): ThemeModeOption {
  return THEME_MODES.find((mode) => mode.value === theme) ?? THEME_MODES[2];
}

/**
 * The next mode when cycling through the compact (single-button) control.
 *
 * Light -> Dark -> Auto -> Light. Auto is deliberately IN the cycle rather than
 * reachable only from a menu: before this existed, touching the toggle at all
 * overwrote `system` permanently, and a control that can leave a state but
 * never return to it is the bug this feature exists to fix.
 */
export function nextThemeMode({ theme }: { theme: Theme }): Theme {
  const index = THEME_MODES.findIndex((mode) => mode.value === theme);
  return THEME_MODES[(index + 1) % THEME_MODES.length].value;
}
