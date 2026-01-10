# @checkstack/maintenance-backend

## 0.0.3

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/backend-api@0.1.0
  - @checkstack/common@0.0.3
  - @checkstack/command-backend@0.0.3
  - @checkstack/integration-backend@0.0.3
  - @checkstack/catalog-common@0.0.3
  - @checkstack/integration-common@0.0.3
  - @checkstack/maintenance-common@0.0.3
  - @checkstack/notification-common@0.0.3
  - @checkstack/signal-common@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/backend-api@0.0.2
  - @checkstack/catalog-common@0.0.2
  - @checkstack/command-backend@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/integration-backend@0.0.2
  - @checkstack/integration-common@0.0.2
  - @checkstack/maintenance-common@0.0.2
  - @checkstack/notification-common@0.0.2
  - @checkstack/signal-common@0.0.2

## 0.1.2

### Patch Changes

- Updated dependencies [4c5aa9e]
- Updated dependencies [b4eb432]
- Updated dependencies [a65e002]
- Updated dependencies [a65e002]
  - @checkstack/integration-backend@0.1.0
  - @checkstack/backend-api@1.1.0
  - @checkstack/common@0.2.0
  - @checkstack/command-backend@0.1.0
  - @checkstack/catalog-common@0.1.2
  - @checkstack/integration-common@0.1.1
  - @checkstack/maintenance-common@0.1.2
  - @checkstack/notification-common@0.1.1
  - @checkstack/signal-common@0.1.1

## 0.1.1

### Patch Changes

- @checkstack/catalog-common@0.1.1
- @checkstack/maintenance-common@0.1.1

## 0.1.0

### Minor Changes

- eff5b4e: Add standalone maintenance scheduling plugin

  - New `@checkstack/maintenance-common` package with Zod schemas, permissions, oRPC contract, and extension slots
  - New `@checkstack/maintenance-backend` package with Drizzle schema, service, and oRPC router
  - New `@checkstack/maintenance-frontend` package with admin page and system detail panel
  - Shared `DateTimePicker` component added to `@checkstack/ui`
  - Database migrations for maintenances, maintenance_systems, and maintenance_updates tables

### Patch Changes

- Updated dependencies [eff5b4e]
- Updated dependencies [ffc28f6]
- Updated dependencies [4dd644d]
- Updated dependencies [71275dd]
- Updated dependencies [ae19ff6]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
- Updated dependencies [81f3f85]
  - @checkstack/maintenance-common@0.1.0
  - @checkstack/common@0.1.0
  - @checkstack/backend-api@1.0.0
  - @checkstack/catalog-common@0.1.0
  - @checkstack/notification-common@0.1.0
  - @checkstack/integration-common@0.1.0
  - @checkstack/signal-common@0.1.0
  - @checkstack/command-backend@0.0.2
  - @checkstack/integration-backend@0.0.2
