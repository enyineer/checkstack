---
"@checkstack/ui": patch
---

fix(ui): stop the Alert icon from being squished by long body text

When an icon is passed as a direct child of `<Alert>` (the raw-icon usage, as
opposed to wrapping it in `<AlertIcon>`), the alert's flex row had no
`shrink-0` on the icon, so a long multi-line body compressed the icon
horizontally into a thin sliver. Added `[&>svg]:shrink-0` to the Alert's inner
container so any direct `<svg>` child keeps its intrinsic size. This fixes every
raw-icon alert at once (e.g. the in-memory cache/queue warnings) without
touching each call site; icons wrapped in `AlertIcon` were already `shrink-0`
and are unaffected.
