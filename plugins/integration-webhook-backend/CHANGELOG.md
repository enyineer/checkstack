# @checkstack/integration-webhook-backend

## 0.0.14

### Patch Changes

- Updated dependencies [f676e11]
- Updated dependencies [48c2080]
  - @checkstack/common@0.6.2
  - @checkstack/backend-api@0.6.0
  - @checkstack/integration-backend@0.1.9
  - @checkstack/integration-common@0.2.5

## 0.0.13

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/backend-api@0.5.2
  - @checkstack/common@0.6.1
  - @checkstack/integration-backend@0.1.8
  - @checkstack/integration-common@0.2.4

## 0.0.12

### Patch Changes

- Updated dependencies [db1f56f]
  - @checkstack/common@0.6.0
  - @checkstack/backend-api@0.5.1
  - @checkstack/integration-backend@0.1.7
  - @checkstack/integration-common@0.2.3

## 0.0.11

### Patch Changes

- Updated dependencies [66a3963]
- Updated dependencies [66a3963]
  - @checkstack/integration-backend@0.1.6
  - @checkstack/backend-api@0.5.0

## 0.0.10

### Patch Changes

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/backend-api@0.4.1
  - @checkstack/common@0.5.0
  - @checkstack/integration-backend@0.1.5
  - @checkstack/integration-common@0.2.2

## 0.0.9

### Patch Changes

- 83557c7: ## Multi-Type Editor Support for Webhooks

  - Updated webhook provider to use new multi-type editor field for body templates

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
  - @checkstack/backend-api@0.4.0
  - @checkstack/common@0.4.0
  - @checkstack/integration-backend@0.1.4
  - @checkstack/integration-common@0.2.1

## 0.0.8

### Patch Changes

- Updated dependencies [d94121b]
  - @checkstack/backend-api@0.3.3
  - @checkstack/integration-backend@0.1.3

## 0.0.7

### Patch Changes

- Updated dependencies [7a23261]
  - @checkstack/common@0.3.0
  - @checkstack/backend-api@0.3.2
  - @checkstack/integration-common@0.2.0
  - @checkstack/integration-backend@0.1.2

## 0.0.6

### Patch Changes

- @checkstack/backend-api@0.3.1
- @checkstack/integration-backend@0.1.1

## 0.0.5

### Patch Changes

- Updated dependencies [9faec1f]
- Updated dependencies [827b286]
- Updated dependencies [f533141]
- Updated dependencies [aa4a8ab]
  - @checkstack/backend-api@0.3.0
  - @checkstack/common@0.2.0
  - @checkstack/integration-backend@0.1.0
  - @checkstack/integration-common@0.1.0

## 0.0.4

### Patch Changes

- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
  - @checkstack/backend-api@0.2.0
  - @checkstack/common@0.1.0
  - @checkstack/integration-backend@0.0.4
  - @checkstack/integration-common@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/backend-api@0.1.0
  - @checkstack/common@0.0.3
  - @checkstack/integration-backend@0.0.3
  - @checkstack/integration-common@0.0.3

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
