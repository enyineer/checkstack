# @checkstack/satellite-frontend

## 0.2.6

### Patch Changes

- Updated dependencies [4b0934d]
  - @checkstack/ui@1.3.6

## 0.2.5

### Patch Changes

- Updated dependencies [286491a]
  - @checkstack/ui@1.3.5

## 0.2.4

### Patch Changes

- Updated dependencies [692c717]
  - @checkstack/ui@1.3.4

## 0.2.3

### Patch Changes

- Updated dependencies [594eecc]
  - @checkstack/ui@1.3.3

## 0.2.2

### Patch Changes

- Updated dependencies [0388000]
  - @checkstack/ui@1.3.2

## 0.2.1

### Patch Changes

- Updated dependencies [765b764]
  - @checkstack/ui@1.3.1

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
  - @checkstack/ui@1.3.0
  - @checkstack/satellite-common@0.2.0
