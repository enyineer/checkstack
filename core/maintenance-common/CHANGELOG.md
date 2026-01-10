# @checkstack/maintenance-common

## 0.0.3

### Patch Changes

- Updated dependencies [f5b1f49]
  - @checkstack/common@0.0.3
  - @checkstack/frontend-api@0.0.3
  - @checkstack/signal-common@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/common@0.0.2
  - @checkstack/frontend-api@0.0.2
  - @checkstack/signal-common@0.0.2

## 0.1.2

### Patch Changes

- Updated dependencies [a65e002]
- Updated dependencies [ae33df2]
- Updated dependencies [32ea706]
  - @checkstack/common@0.2.0
  - @checkstack/frontend-api@0.1.0
  - @checkstack/signal-common@0.1.1

## 0.1.1

### Patch Changes

- Updated dependencies [0f8cc7d]
  - @checkstack/frontend-api@0.0.3

## 0.1.0

### Minor Changes

- eff5b4e: Add standalone maintenance scheduling plugin

  - New `@checkstack/maintenance-common` package with Zod schemas, permissions, oRPC contract, and extension slots
  - New `@checkstack/maintenance-backend` package with Drizzle schema, service, and oRPC router
  - New `@checkstack/maintenance-frontend` package with admin page and system detail panel
  - Shared `DateTimePicker` component added to `@checkstack/ui`
  - Database migrations for maintenances, maintenance_systems, and maintenance_updates tables

- 4dd644d: Enable external application (API key) access to management endpoints

  Changed `userType: "user"` to `userType: "authenticated"` for 52 endpoints across 5 packages, allowing external applications (service accounts with API keys) to call these endpoints programmatically while maintaining RBAC permission checks:

  - **incident-common**: createIncident, updateIncident, addUpdate, resolveIncident, deleteIncident
  - **maintenance-common**: createMaintenance, updateMaintenance, addUpdate, closeMaintenance, deleteMaintenance
  - **catalog-common**: System CRUD, Group CRUD, addSystemToGroup, removeSystemFromGroup
  - **healthcheck-common**: Configuration management, system associations, retention config, detailed history
  - **integration-common**: Subscription management, connection management, event discovery, delivery logs

  This enables automation use cases such as:

  - Creating incidents from external monitoring systems (Prometheus, Grafana)
  - Scheduling maintenances from CI/CD pipelines
  - Managing catalog systems from infrastructure-as-code tools
  - Configuring health checks from deployment scripts

### Patch Changes

- Updated dependencies [ffc28f6]
- Updated dependencies [b55fae6]
  - @checkstack/common@0.1.0
  - @checkstack/signal-common@0.1.0
  - @checkstack/frontend-api@0.0.2
