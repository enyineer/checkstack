# @checkmate-monitor/catalog-backend

## 0.1.0

### Minor Changes

- a65e002: Add command palette commands and deep-linking support

  **Backend Changes:**

  - `healthcheck-backend`: Add "Manage Health Checks" (⇧⌘H) and "Create Health Check" commands
  - `catalog-backend`: Add "Manage Systems" (⇧⌘S) and "Create System" commands
  - `integration-backend`: Add "Manage Integrations" (⇧⌘G), "Create Integration Subscription", and "View Integration Logs" commands
  - `auth-backend`: Add "Manage Users" (⇧⌘U), "Create User", "Manage Roles", and "Manage Applications" commands
  - `command-backend`: Auto-cleanup command registrations when plugins are deregistered

  **Frontend Changes:**

  - `HealthCheckConfigPage`: Handle `?action=create` URL parameter
  - `CatalogConfigPage`: Handle `?action=create` URL parameter
  - `IntegrationsPage`: Handle `?action=create` URL parameter
  - `AuthSettingsPage`: Handle `?tab=` and `?action=create` URL parameters

### Patch Changes

- Updated dependencies [b4eb432]
- Updated dependencies [a65e002]
- Updated dependencies [a65e002]
  - @checkmate-monitor/backend-api@1.1.0
  - @checkmate-monitor/common@0.2.0
  - @checkmate-monitor/command-backend@0.1.0
  - @checkmate-monitor/catalog-common@0.1.2
  - @checkmate-monitor/notification-common@0.1.1

## 0.0.3

### Patch Changes

- @checkmate-monitor/catalog-common@0.1.1

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
  - @checkmate-monitor/notification-common@0.1.0
  - @checkmate-monitor/command-backend@0.0.2
