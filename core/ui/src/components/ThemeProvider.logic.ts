/**
 * The theme a user has CHOSEN.
 *
 * `system` (surfaced as "Auto") is a real, persisted choice - not the absence
 * of one. It means "follow the OS", and it must survive being explicitly picked
 * just like `light` or `dark` do.
 */
export type Theme = "light" | "dark" | "system";

/** The theme actually painted. `system` always collapses into one of these. */
export type ResolvedTheme = "light" | "dark";

/** The media query whose match decides what `system` resolves to. */
export const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

/**
 * Collapse a chosen theme into the one actually painted.
 *
 * Pure and total, so the provider's rendering can never disagree with what a
 * test asserts: the OS preference is an INPUT here rather than something read
 * from the environment mid-render.
 */
export function resolveTheme({
  theme,
  systemPrefersDark,
}: {
  theme: Theme;
  systemPrefersDark: boolean;
}): ResolvedTheme {
  if (theme === "system") return systemPrefersDark ? "dark" : "light";
  return theme;
}

/**
 * Narrow an untrusted stored value to a `Theme`.
 *
 * `localStorage` is user-writable and survives downgrades, so a value there may
 * be anything at all. An unrecognised value falls back rather than being cast,
 * which would put a bogus class name on `<html>`.
 */
export function parseStoredTheme({
  value,
  fallback,
}: {
  value: string | null;
  fallback: Theme;
}): Theme {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : fallback;
}
