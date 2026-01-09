---
"@checkmate-monitor/command-frontend": minor
"@checkmate-monitor/dashboard-frontend": minor
"@checkmate-monitor/frontend-api": minor
"@checkmate-monitor/auth-frontend": patch
"@checkmate-monitor/notification-frontend": patch
"@checkmate-monitor/theme-frontend": patch
"@checkmate-monitor/frontend": patch
---

Move command palette from dashboard to centered navbar position

- Converted `command-frontend` into a plugin with `NavbarCenterSlot` extension
- Added compact `NavbarSearch` component with responsive search trigger
- Moved `SearchDialog` from dashboard-frontend to command-frontend
- Keyboard shortcut (⌘K / Ctrl+K) now works on every page
- Renamed navbar slots for clarity:
  - `NavbarSlot` → `NavbarRightSlot`
  - `NavbarMainSlot` → `NavbarLeftSlot`
  - Added new `NavbarCenterSlot` for centered content
