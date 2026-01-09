# @checkmate-monitor/incident-backend

## 0.0.4

### Patch Changes

- a65e002: Add compile-time type safety for Lucide icon names

  - Add `LucideIconName` type and `lucideIconSchema` Zod schema to `@checkmate-monitor/common`
  - Update backend interfaces (`AuthStrategy`, `NotificationStrategy`, `IntegrationProvider`, `CommandDefinition`) to use `LucideIconName`
  - Update RPC contracts to use `lucideIconSchema` for proper type inference across RPC boundaries
  - Simplify `SocialProviderButton` to use `DynamicIcon` directly (removes 30+ lines of pascalCase conversion)
  - Replace static `iconMap` in `SearchDialog` with `DynamicIcon` for dynamic icon rendering
  - Add fallback handling in `DynamicIcon` when icon name isn't found
  - Fix legacy kebab-case icon names to PascalCase: `mail`→`Mail`, `send`→`Send`, `github`→`Github`, `key-round`→`KeyRound`, `network`→`Network`, `AlertCircle`→`CircleAlert`

- Updated dependencies [4c5aa9e]
- Updated dependencies [b4eb432]
- Updated dependencies [a65e002]
- Updated dependencies [a65e002]
  - @checkmate-monitor/integration-backend@0.1.0
  - @checkmate-monitor/backend-api@1.1.0
  - @checkmate-monitor/common@0.2.0
  - @checkmate-monitor/command-backend@0.1.0
  - @checkmate-monitor/catalog-backend@0.1.0
  - @checkmate-monitor/catalog-common@0.1.2
  - @checkmate-monitor/incident-common@0.1.2
  - @checkmate-monitor/integration-common@0.1.1
  - @checkmate-monitor/signal-common@0.1.1

## 0.0.3

### Patch Changes

- @checkmate-monitor/catalog-common@0.1.1
- @checkmate-monitor/incident-common@0.1.1
- @checkmate-monitor/catalog-backend@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [ffc28f6]
- Updated dependencies [4dd644d]
- Updated dependencies [71275dd]
- Updated dependencies [ae19ff6]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
- Updated dependencies [81f3f85]
  - @checkmate-monitor/common@0.1.0
  - @checkmate-monitor/backend-api@1.0.0
  - @checkmate-monitor/catalog-common@0.1.0
  - @checkmate-monitor/incident-common@0.1.0
  - @checkmate-monitor/integration-common@0.1.0
  - @checkmate-monitor/signal-common@0.1.0
  - @checkmate-monitor/catalog-backend@0.0.2
  - @checkmate-monitor/command-backend@0.0.2
  - @checkmate-monitor/integration-backend@0.0.2
