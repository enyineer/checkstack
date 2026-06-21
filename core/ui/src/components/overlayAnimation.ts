/**
 * Tailwind animation classes for the modal scrim shared by {@link Dialog}
 * and {@link Sheet}.
 *
 * The overlay is animated IN only. It deliberately has NO exit animation
 * (`animate-out` / `fade-out`). The overlay is a full-screen,
 * `pointer-events: auto` scrim, and an exit animation makes its removal
 * depend on an `animationend` event reaching Radix's `Presence` state
 * machine. When a second dialog/sheet opens while this one is mid-close
 * (e.g. close a trigger Sheet, then immediately open an "Add step" Dialog),
 * the closing overlay's animation can be interrupted so its `animationend`
 * never lands. `Presence` then stays in `unmountSuspended` and the scrim is
 * orphaned in the DOM, where it swallows every subsequent click (the classic
 * "Save button click hangs under a dim screen" bug).
 *
 * With no exit animation, `getComputedStyle(overlay).animationName` is
 * `"none"` on close, so Radix unmounts the overlay synchronously - no event
 * dependency, no orphan. The dialog/sheet Content still animates out, which
 * is the motion the user actually perceives.
 *
 * > [!IMPORTANT]
 * > Do NOT add `data-[state=closed]:animate-out` / `fade-out` to the overlay.
 * > It reintroduces the orphan-scrim bug. Exit motion belongs on the Content.
 */
export const OVERLAY_ENTER_ANIMATION =
  "data-[state=open]:animate-in data-[state=open]:fade-in-0";
