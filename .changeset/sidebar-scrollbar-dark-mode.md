---
"@checkstack/ui": patch
---

Fix native scrollbars and form controls staying light in dark mode.

The app never declared a `color-scheme`, so Chromium/Edge and Firefox painted
native scrollbars (e.g. the sidebar) and form controls in the OS default (light)
regardless of the active theme. Declaring `color-scheme: light` / `dark` on
`:root` / `.dark` makes them follow the theme.
