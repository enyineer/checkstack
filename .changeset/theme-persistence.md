---
"@checkmate-monitor/theme-frontend": minor
---

Add theme persistence for non-logged-in users via local storage

- Added `NavbarThemeToggle` component that shows a Sun/Moon button in the navbar for non-logged-in users
- Added `ThemeSynchronizer` component that loads theme from backend for logged-in users on page load
- Theme is now applied immediately on page load for logged-in users (no need to open user menu first)
- Non-logged-in users can now toggle theme, which persists in local storage
- Logged-in user's backend-saved theme takes precedence over local storage
