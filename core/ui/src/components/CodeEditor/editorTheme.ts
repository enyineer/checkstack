/**
 * Pure theme-mapping constants for the Monaco editor. Extracted here (and not
 * inlined in TypefoxEditor.tsx) so the logic can be unit-tested without
 * importing browser-only Monaco modules.
 */

/**
 * Maps the app's resolved theme to the matching Monaco built-in theme
 * identifier. Only the two built-in standalone themes are used: the VS Code
 * 'Default Dark Modern' theme would require the extension-host theme-defaults
 * extension, which the standalone setup omits.
 */
export const MONACO_THEME_MAP: Record<"light" | "dark", string> = {
  light: "vs",
  dark: "vs-dark",
};

/**
 * Color used for the `{{ }}` / `$VAR` decoration in each Monaco theme.
 * - vs-dark uses #9cdcfe (the VS Code dark "variable" token).
 * - vs (light) uses #0070c1 (the VS Code light "variable.other" token).
 */
export const VARIABLE_TOKEN_COLOR: Record<"light" | "dark", string> = {
  light: "#0070c1",
  dark: "#9cdcfe",
};
