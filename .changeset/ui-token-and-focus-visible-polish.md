---
"@checkstack/ui": patch
---

Align a few components with semantic design tokens and the library's
focus-visible convention. `StatusCard`'s gradient variant now derives from
`--primary` (`from-primary to-primary/80 text-primary-foreground`) instead of
hardcoded indigo/purple and literal `text-white`, so it tracks the theme.
`LoadingSpinner`'s track uses `border-muted border-t-primary` instead of
`border-indigo-200 border-t-indigo-500`. The `Dialog` and `Sheet` close ("X")
buttons now use `focus-visible:ring-*` to match `Button`/`Checkbox`, so the
ring only shows on keyboard focus. No behavioral or visual changes beyond the
token/theme alignment.
