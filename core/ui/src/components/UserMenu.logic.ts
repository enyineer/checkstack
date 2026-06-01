/**
 * Pure, DOM-free logic for {@link UserMenu}, separated so it can be unit
 * tested without a browser environment.
 *
 * The repo's CI runs `bun test` from the repo root, which does NOT load the
 * frontend happy-dom preload (that only applies when `bun test` runs with cwd
 * inside `core/ui`). Component-render tests therefore cannot run in CI, so the
 * testable behaviour lives here and is exercised by `UserMenu.logic.test.ts`
 * (the same `*.logic.ts` + `*.logic.test.ts` split used by `ScriptTestPanel`).
 */

/**
 * Class names for the desktop user-menu popover content.
 *
 * Bounds the popover to the space the trigger leaves below it
 * (`--radix-popover-content-available-height`) and makes the body scroll, so
 * on short viewports the lower menu items stay reachable. The two-column grid
 * (`sm:grid-cols-2`) is retained.
 */
export const DESKTOP_POPOVER_CONTENT_CLASS =
  "w-[400px] md:w-[460px] p-2 grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-[var(--radix-popover-content-available-height)] overflow-y-auto";

/**
 * The name/email header renders as a clickable profile link only when a
 * non-empty `profileHref` is provided; otherwise it is a non-interactive
 * label. This is the single source of truth for that branch in `UserMenu`.
 */
export function shouldRenderProfileHeaderLink(profileHref?: string): boolean {
  return typeof profileHref === "string" && profileHref.length > 0;
}
