/**
 * Single source of truth for the global search/command trigger's copy and
 * keyboard shortcut hint, shared by every affordance that opens the search
 * dialog (the navbar trigger and the hero CommandPalette). Keeping these in one
 * place prevents the trigger's wording and shortcut hint from drifting apart.
 */

/** Compact placeholder used by the navbar trigger. */
export const SEARCH_TRIGGER_LABEL = "Search...";

/**
 * Hero placeholder. Kept accurate to what search actually delivers (entity
 * search + commands) - it must not over-promise specific result types.
 */
export const SEARCH_TRIGGER_PLACEHOLDER = "Search and commands...";

/** Modifier key glyph/word for the shortcut hint, by platform. */
export const SEARCH_SHORTCUT_KEY = "K";

/**
 * Whether the current platform uses the Cmd (⌘) modifier. Returns false during
 * SSR / when `navigator` is unavailable so the non-Mac hint is rendered.
 */
export const isMacPlatform = (): boolean =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent);
