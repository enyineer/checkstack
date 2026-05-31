/**
 * Marker attribute placed on a combobox's anchor `<input>` so a Radix
 * `PopoverContent`'s dismissable layer can recognize an interaction that
 * originated on the anchor itself.
 *
 * Radix treats the anchor as "outside" the floating content, so the very
 * click/focus that opens the list also fires `onPointerDownOutside` /
 * `onFocusOutside` and dismisses it on the same frame (the "opens then
 * immediately closes" flicker). Guarding those handlers against anchor-origin
 * events keeps the list open.
 *
 * Usage (see `PackageNameCombobox` / `SecretEnvEditor`):
 *   1. Spread {@link comboboxAnchorProps} onto the anchor `<input>`.
 *   2. On `PopoverContent`, in both `onPointerDownOutside` and
 *      `onFocusOutside`, call `event.preventDefault()` when
 *      {@link isAnchorInteraction} matches the event target.
 *   3. Prevent `onCloseAutoFocus` default.
 *   4. Option buttons use `onMouseDown` + `preventDefault` so a click selects
 *      before the input blurs.
 *
 * Lives in `@checkstack/ui` so every combobox (across plugins) shares one
 * implementation.
 */
export const COMBOBOX_ANCHOR_ATTR = "data-combobox-anchor";

/** Props to spread onto the anchor `<input>` so {@link isAnchorInteraction} can match it. */
export const comboboxAnchorProps: Record<string, string> = {
  [COMBOBOX_ANCHOR_ATTR]: "",
};

/**
 * Whether an event target is (or is inside) a combobox anchor input. Pure +
 * DOM-only so it is unit-testable without a React render. Tolerates a null
 * target and non-Element targets (returns false).
 */
export function isAnchorInteraction(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  return target.closest(`[${COMBOBOX_ANCHOR_ATTR}]`) !== null;
}
