---
"@checkstack/ui": minor
"@checkstack/theme-frontend": minor
---

Auto theme option, and fix Auto never updating

The theme control is now a three-way Light / Dark / **Auto** selector. Auto
persists `system` and follows the operating system's preference.

This fixes two related bugs:

- **Auto was a one-way door.** The backend, schema and `ThemeProvider` had always
  supported `system`, but both toggles were binary and could only ever write
  `light` or `dark`. Touching the control once destroyed a user's Auto
  preference permanently, with nothing able to write it back.
- **Auto did not react.** `ThemeProvider` read `matchMedia(...).matches` during
  render with no listener, so a live OS light/dark switch did not repaint until
  something unrelated re-rendered. It now subscribes and repaints immediately.

Theme resolution is extracted into a pure `resolveTheme` (exported from
`@checkstack/ui`), and a value read from `localStorage` is now narrowed rather
than cast - a hand-edited value can no longer put a bogus class on `<html>`.
