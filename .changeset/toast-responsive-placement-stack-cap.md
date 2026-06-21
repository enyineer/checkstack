---
"@checkstack/ui": patch
---

Make toast placement responsive and cap the visible toast stack.

The toast container was hard-pinned to `top-4 right-4` with a `max-w-md` width
on every viewport and no limit on how many toasts stacked at once. On narrow
screens that produced a cramped, off-to-the-side column that could grow without
bound.

Toasts now render full-width inset at the bottom (`inset-x-4 bottom-4`) below
`sm`, and revert to the familiar top-right card stack (`sm:top-4 sm:right-4`,
`sm:max-w-md`) from `sm` upward. At most three toasts render at once; any older
queued toasts surface a subtle "+N more" indicator and become visible as the
most-recent ones auto-dismiss or are dismissed. Per-toast auto-dismiss,
hover-to-pause, and the public `toast.success/error/warning/info/show` API are
unchanged.
