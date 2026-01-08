# @checkmate-monitor/maintenance-common

## 0.1.0

### Minor Changes

- eff5b4e: Add standalone maintenance scheduling plugin

  - New `@checkmate-monitor/maintenance-common` package with Zod schemas, permissions, oRPC contract, and extension slots
  - New `@checkmate-monitor/maintenance-backend` package with Drizzle schema, service, and oRPC router
  - New `@checkmate-monitor/maintenance-frontend` package with admin page and system detail panel
  - Shared `DateTimePicker` component added to `@checkmate-monitor/ui`
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
  - @checkmate-monitor/common@0.1.0
  - @checkmate-monitor/signal-common@0.1.0
  - @checkmate-monitor/frontend-api@0.0.2
