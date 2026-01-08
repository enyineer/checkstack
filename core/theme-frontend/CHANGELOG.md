# @checkmate-monitor/theme-frontend

## 0.1.2

### Patch Changes

- Updated dependencies [e26c08e]
  - @checkmate-monitor/auth-frontend@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [0f8cc7d]
  - @checkmate-monitor/frontend-api@0.0.3
  - @checkmate-monitor/auth-frontend@0.1.1
  - @checkmate-monitor/ui@0.1.1

## 0.1.0

### Minor Changes

- d673ab4: Add theme persistence for non-logged-in users via local storage

  - Added `NavbarThemeToggle` component that shows a Sun/Moon button in the navbar for non-logged-in users
  - Added `ThemeSynchronizer` component that loads theme from backend for logged-in users on page load
  - Theme is now applied immediately on page load for logged-in users (no need to open user menu first)
  - Non-logged-in users can now toggle theme, which persists in local storage
  - Logged-in user's backend-saved theme takes precedence over local storage

### Patch Changes

- Updated dependencies [eff5b4e]
- Updated dependencies [ffc28f6]
- Updated dependencies [32f2535]
- Updated dependencies [b354ab3]
  - @checkmate-monitor/ui@0.1.0
  - @checkmate-monitor/common@0.1.0
  - @checkmate-monitor/auth-frontend@0.1.0
  - @checkmate-monitor/frontend-api@0.0.2
  - @checkmate-monitor/theme-common@0.0.2
