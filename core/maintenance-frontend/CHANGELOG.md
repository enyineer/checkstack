# @checkmate-monitor/maintenance-frontend

## 0.1.0

### Minor Changes

- eff5b4e: Add standalone maintenance scheduling plugin

  - New `@checkmate-monitor/maintenance-common` package with Zod schemas, permissions, oRPC contract, and extension slots
  - New `@checkmate-monitor/maintenance-backend` package with Drizzle schema, service, and oRPC router
  - New `@checkmate-monitor/maintenance-frontend` package with admin page and system detail panel
  - Shared `DateTimePicker` component added to `@checkmate-monitor/ui`
  - Database migrations for maintenances, maintenance_systems, and maintenance_updates tables

### Patch Changes

- Updated dependencies [eff5b4e]
- Updated dependencies [ffc28f6]
- Updated dependencies [4dd644d]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
  - @checkmate-monitor/maintenance-common@0.1.0
  - @checkmate-monitor/ui@0.1.0
  - @checkmate-monitor/common@0.1.0
  - @checkmate-monitor/catalog-common@0.1.0
  - @checkmate-monitor/signal-frontend@0.1.0
  - @checkmate-monitor/frontend-api@0.0.2
