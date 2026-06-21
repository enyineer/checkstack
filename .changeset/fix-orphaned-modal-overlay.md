---
"@checkstack/ui": patch
---

Fix an orphaned modal scrim that could block clicks after a Sheet/Dialog closes.

The shared `Dialog` and `Sheet` overlays previously carried a
`data-[state=closed]` exit animation. Because the overlay is a full-screen,
`pointer-events: auto` scrim, that exit animation made its removal depend on
an `animationend` event reaching Radix's `Presence` state machine. When a
second dialog/sheet opened while the first was still mid-close (for example,
closing an automation trigger Sheet and immediately opening the "Add step"
Dialog), the closing overlay's animation could be interrupted and its
`animationend` never landed. `Presence` then stayed in `unmountSuspended` and
the dim scrim was orphaned in the DOM, intercepting every subsequent click
(the Save button appeared visible and enabled but clicks never landed).

The overlay now animates in only. With no exit animation,
`getComputedStyle(overlay).animationName` is `"none"` on close, so Radix
unmounts the overlay synchronously - no event dependency, no orphan. The
dialog/sheet Content still animates out, so the visible motion is unchanged.
Scroll-lock, focus return, and the nested-sheet portal-into-content behavior
are untouched.
