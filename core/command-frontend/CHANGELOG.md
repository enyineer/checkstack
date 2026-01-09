# @checkmate-monitor/command-frontend

## 0.1.0

### Minor Changes

- ae33df2: Move command palette from dashboard to centered navbar position

  - Converted `command-frontend` into a plugin with `NavbarCenterSlot` extension
  - Added compact `NavbarSearch` component with responsive search trigger
  - Moved `SearchDialog` from dashboard-frontend to command-frontend
  - Keyboard shortcut (⌘K / Ctrl+K) now works on every page
  - Renamed navbar slots for clarity:
    - `NavbarSlot` → `NavbarRightSlot`
    - `NavbarMainSlot` → `NavbarLeftSlot`
    - Added new `NavbarCenterSlot` for centered content

### Patch Changes

- Updated dependencies [52231ef]
- Updated dependencies [b0124ef]
- Updated dependencies [54cc787]
- Updated dependencies [a65e002]
- Updated dependencies [ae33df2]
- Updated dependencies [32ea706]
  - @checkmate-monitor/ui@0.1.2
  - @checkmate-monitor/common@0.2.0
  - @checkmate-monitor/frontend-api@0.1.0
  - @checkmate-monitor/command-common@0.0.3

## 0.0.3

### Patch Changes

- Updated dependencies [0f8cc7d]
  - @checkmate-monitor/frontend-api@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [ffc28f6]
  - @checkmate-monitor/common@0.1.0
  - @checkmate-monitor/command-common@0.0.2
  - @checkmate-monitor/frontend-api@0.0.2
