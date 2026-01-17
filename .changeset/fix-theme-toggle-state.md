---
"@checkstack/ui": patch
"@checkstack/theme-frontend": patch
"@checkstack/frontend": patch
---

Fix theme toggle showing incorrect state when system theme is used

- Added `resolvedTheme` property to `ThemeProvider` that returns the actual computed theme ("light" or "dark"), resolving "system" to the user's OS preference
- Updated `NavbarThemeToggle` and `ThemeToggleMenuItem` to use `resolvedTheme` instead of `theme` for determining toggle state
- Changed default theme from "light" to "system" so non-logged-in users respect their OS color scheme preference
