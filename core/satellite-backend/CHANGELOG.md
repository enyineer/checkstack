# @checkstack/satellite-backend

## 0.2.6

### Patch Changes

- Updated dependencies [8ef367a]
- Updated dependencies [cb65e9d]
  - @checkstack/healthcheck-backend@0.15.0

## 0.2.5

### Patch Changes

- @checkstack/healthcheck-backend@0.14.3

## 0.2.4

### Patch Changes

- @checkstack/healthcheck-backend@0.14.2

## 0.2.3

### Patch Changes

- @checkstack/healthcheck-backend@0.14.1

## 0.2.2

### Patch Changes

- Updated dependencies [6c40b5b]
  - @checkstack/healthcheck-backend@0.14.0

## 0.2.1

### Patch Changes

- Updated dependencies [aa2b3aa]
  - @checkstack/healthcheck-backend@0.13.1

## 0.2.0

### Minor Changes

- 26d8bae: Distributed satellite health checks and Assignment IDE page

  **Satellite System**

  - New `satellite-backend`, `satellite-common`, `satellite-frontend`, and `satellite` agent packages for distributed health check execution
  - WebSocket-based satellite connectivity with authentication, heartbeats, and live configuration push
  - Satellite management UI with create dialog, status badges, and list page

  **Live Configuration Updates**

  - Added `assignmentChanged` hook to `healthcheck-backend` for cross-plugin communication
  - `satellite-backend` subscribes to assignment changes and pushes config updates to connected satellites in real-time

  **Assignment IDE Page**

  - Replaced the 1028-line modal-based `SystemHealthCheckAssignment` component with a full-page IDE layout
  - New modular components: `AssignmentTree`, `GeneralPanel`, `ThresholdsPanel`, `RetentionPanel`, `ExecutionPanel`
  - Added unassign capability and sorted assignment lists for stable ordering

  **Shared IDE Primitives**

  - Extracted `IDETreeNode`, `IDETreeSection`, `IDEStatusBar`, `IDELayout` to `@checkstack/ui` for cross-plugin reuse
  - Migrated existing health check IDE editor to use shared primitives

  **Infrastructure**

  - Added `Dockerfile.satellite` for containerized satellite deployment
  - WebSocket route registry in `@checkstack/backend` and `@checkstack/backend-api`

### Patch Changes

- Updated dependencies [26d8bae]
- Updated dependencies [26d8bae]
  - @checkstack/healthcheck-common@0.11.0
  - @checkstack/healthcheck-backend@0.13.0
  - @checkstack/satellite-common@0.2.0
  - @checkstack/backend-api@0.12.0
  - @checkstack/queue-api@0.2.13
