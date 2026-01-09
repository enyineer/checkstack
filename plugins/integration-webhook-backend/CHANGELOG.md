# @checkstack/integration-webhook-backend

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/backend-api@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/integration-backend@0.0.2
  - @checkstack/integration-common@0.0.2

## 0.1.0

### Minor Changes

- 4c5aa9e: Fix `IntegrationProvider.testConnection` generic type

  - **Breaking**: `testConnection` now receives `TConnection` (connection config) instead of `TConfig` (subscription config)
  - **Breaking**: `RegisteredIntegrationProvider` now includes `TConnection` generic parameter
  - Removed `testConnection` from webhook provider (providers without `connectionSchema` cannot have `testConnection`)
  - Fixed Jira provider to use `JiraConnectionConfig` directly in `testConnection`

  This aligns the interface with the actual behavior: `testConnection` tests connection credentials, not subscription configuration.

### Patch Changes

- Updated dependencies [4c5aa9e]
- Updated dependencies [b4eb432]
- Updated dependencies [a65e002]
- Updated dependencies [a65e002]
  - @checkstack/integration-backend@0.1.0
  - @checkstack/backend-api@1.1.0
  - @checkstack/common@0.2.0
  - @checkstack/integration-common@0.1.1

## 0.0.2

### Patch Changes

- Updated dependencies [ffc28f6]
- Updated dependencies [4dd644d]
- Updated dependencies [71275dd]
- Updated dependencies [ae19ff6]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
- Updated dependencies [81f3f85]
  - @checkstack/common@0.1.0
  - @checkstack/backend-api@1.0.0
  - @checkstack/integration-common@0.1.0
  - @checkstack/integration-backend@0.0.2
