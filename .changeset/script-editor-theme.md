---
"@checkstack/ui": patch
---

fix(ui): script editor now follows the app theme (light/dark)

The Monaco editor was hardcoded to `vs-dark` regardless of the user's
selected appearance. The editor now reads `resolvedTheme` from
`useTheme()`, uses `vs` in light mode and `vs-dark` in dark mode, and
updates live when the user toggles the theme via an imperative
`monaco.editor.setTheme()` effect. The `{{ }}`/`$VAR` decoration color
is also theme-aware (`#0070c1` light, `#9cdcfe` dark) and refreshes on
toggle.
