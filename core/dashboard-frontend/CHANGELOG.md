# @checkstack/dashboard-frontend

## 0.0.4

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/auth-frontend@0.0.4
  - @checkstack/healthcheck-common@0.1.0
  - @checkstack/common@0.0.3
  - @checkstack/ui@0.0.4
  - @checkstack/catalog-frontend@0.0.4
  - @checkstack/catalog-common@0.0.3
  - @checkstack/command-common@0.0.3
  - @checkstack/command-frontend@0.0.4
  - @checkstack/frontend-api@0.0.3
  - @checkstack/incident-common@0.0.3
  - @checkstack/maintenance-common@0.0.3
  - @checkstack/notification-common@0.0.3
  - @checkstack/signal-frontend@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [cb82e4d]
  - @checkstack/healthcheck-common@0.0.3
  - @checkstack/signal-frontend@0.0.3
  - @checkstack/ui@0.0.3
  - @checkstack/auth-frontend@0.0.3
  - @checkstack/catalog-frontend@0.0.3
  - @checkstack/command-frontend@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/auth-frontend@0.0.2
  - @checkstack/catalog-common@0.0.2
  - @checkstack/catalog-frontend@0.0.2
  - @checkstack/command-common@0.0.2
  - @checkstack/command-frontend@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/frontend-api@0.0.2
  - @checkstack/healthcheck-common@0.0.2
  - @checkstack/incident-common@0.0.2
  - @checkstack/maintenance-common@0.0.2
  - @checkstack/notification-common@0.0.2
  - @checkstack/signal-frontend@0.0.2
  - @checkstack/ui@0.0.2

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

  - Add `LucideIconName` type and `lucideIconSchema` Zod schema to `@checkstack/common`
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
  - @checkstack/auth-frontend@0.3.0
  - @checkstack/ui@0.1.2
  - @checkstack/catalog-frontend@0.1.0
  - @checkstack/common@0.2.0
  - @checkstack/command-frontend@0.1.0
  - @checkstack/frontend-api@0.1.0
  - @checkstack/catalog-common@0.1.2
  - @checkstack/command-common@0.0.3
  - @checkstack/healthcheck-common@0.1.1
  - @checkstack/incident-common@0.1.2
  - @checkstack/maintenance-common@0.1.2
  - @checkstack/notification-common@0.1.1
  - @checkstack/signal-frontend@0.1.1

## 0.0.5

### Patch Changes

- Updated dependencies [1bf71bb]
  - @checkstack/auth-frontend@0.2.1
  - @checkstack/catalog-frontend@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [e26c08e]
  - @checkstack/auth-frontend@0.2.0
  - @checkstack/catalog-frontend@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [0f8cc7d]
  - @checkstack/frontend-api@0.0.3
  - @checkstack/auth-frontend@0.1.1
  - @checkstack/catalog-common@0.1.1
  - @checkstack/catalog-frontend@0.0.3
  - @checkstack/command-frontend@0.0.3
  - @checkstack/incident-common@0.1.1
  - @checkstack/maintenance-common@0.1.1
  - @checkstack/ui@0.1.1

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
  - @checkstack/maintenance-common@0.1.0
  - @checkstack/ui@0.1.0
  - @checkstack/common@0.1.0
  - @checkstack/catalog-common@0.1.0
  - @checkstack/notification-common@0.1.0
  - @checkstack/incident-common@0.1.0
  - @checkstack/healthcheck-common@0.1.0
  - @checkstack/auth-frontend@0.1.0
  - @checkstack/signal-frontend@0.1.0
  - @checkstack/catalog-frontend@0.0.2
  - @checkstack/command-common@0.0.2
  - @checkstack/command-frontend@0.0.2
  - @checkstack/frontend-api@0.0.2
