# @checkmate-monitor/dashboard-frontend

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

- a65e002: Add compile-time type safety for Lucide icon names

  - Add `LucideIconName` type and `lucideIconSchema` Zod schema to `@checkmate-monitor/common`
  - Update backend interfaces (`AuthStrategy`, `NotificationStrategy`, `IntegrationProvider`, `CommandDefinition`) to use `LucideIconName`
  - Update RPC contracts to use `lucideIconSchema` for proper type inference across RPC boundaries
  - Simplify `SocialProviderButton` to use `DynamicIcon` directly (removes 30+ lines of pascalCase conversion)
  - Replace static `iconMap` in `SearchDialog` with `DynamicIcon` for dynamic icon rendering
  - Add fallback handling in `DynamicIcon` when icon name isn't found
  - Fix legacy kebab-case icon names to PascalCase: `mail`→`Mail`, `send`→`Send`, `github`→`Github`, `key-round`→`KeyRound`, `network`→`Network`, `AlertCircle`→`CircleAlert`

- Updated dependencies [52231ef]
- Updated dependencies [b0124ef]
- Updated dependencies [54cc787]
- Updated dependencies [a65e002]
- Updated dependencies [ae33df2]
- Updated dependencies [a65e002]
- Updated dependencies [32ea706]
  - @checkmate-monitor/auth-frontend@0.3.0
  - @checkmate-monitor/ui@0.1.2
  - @checkmate-monitor/catalog-frontend@0.1.0
  - @checkmate-monitor/common@0.2.0
  - @checkmate-monitor/command-frontend@0.1.0
  - @checkmate-monitor/frontend-api@0.1.0
  - @checkmate-monitor/catalog-common@0.1.2
  - @checkmate-monitor/command-common@0.0.3
  - @checkmate-monitor/healthcheck-common@0.1.1
  - @checkmate-monitor/incident-common@0.1.2
  - @checkmate-monitor/maintenance-common@0.1.2
  - @checkmate-monitor/notification-common@0.1.1
  - @checkmate-monitor/signal-frontend@0.1.1

## 0.0.5

### Patch Changes

- Updated dependencies [1bf71bb]
  - @checkmate-monitor/auth-frontend@0.2.1
  - @checkmate-monitor/catalog-frontend@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [e26c08e]
  - @checkmate-monitor/auth-frontend@0.2.0
  - @checkmate-monitor/catalog-frontend@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [0f8cc7d]
  - @checkmate-monitor/frontend-api@0.0.3
  - @checkmate-monitor/auth-frontend@0.1.1
  - @checkmate-monitor/catalog-common@0.1.1
  - @checkmate-monitor/catalog-frontend@0.0.3
  - @checkmate-monitor/command-frontend@0.0.3
  - @checkmate-monitor/incident-common@0.1.1
  - @checkmate-monitor/maintenance-common@0.1.1
  - @checkmate-monitor/ui@0.1.1

## 0.0.2

### Patch Changes

- Updated dependencies [eff5b4e]
- Updated dependencies [ffc28f6]
- Updated dependencies [4dd644d]
- Updated dependencies [ae19ff6]
- Updated dependencies [0babb9c]
- Updated dependencies [32f2535]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
  - @checkmate-monitor/maintenance-common@0.1.0
  - @checkmate-monitor/ui@0.1.0
  - @checkmate-monitor/common@0.1.0
  - @checkmate-monitor/catalog-common@0.1.0
  - @checkmate-monitor/notification-common@0.1.0
  - @checkmate-monitor/incident-common@0.1.0
  - @checkmate-monitor/healthcheck-common@0.1.0
  - @checkmate-monitor/auth-frontend@0.1.0
  - @checkmate-monitor/signal-frontend@0.1.0
  - @checkmate-monitor/catalog-frontend@0.0.2
  - @checkmate-monitor/command-common@0.0.2
  - @checkmate-monitor/command-frontend@0.0.2
  - @checkmate-monitor/frontend-api@0.0.2
