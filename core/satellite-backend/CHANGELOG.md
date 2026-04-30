# @checkstack/satellite-backend

## 0.2.18

### Patch Changes

- 32d52c6: chore: add `drizzle-kit` as a dev dependency

  Lets each backend package run `drizzle-kit generate` locally without
  relying on the workspace-level binary. No runtime impact — devDeps
  only.

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/healthcheck-common@1.0.0
  - @checkstack/healthcheck-backend@1.0.0
  - @checkstack/backend-api@0.14.0
  - @checkstack/satellite-common@0.3.1
  - @checkstack/queue-api@0.2.16

## 0.2.17

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/signal-common@0.2.0
  - @checkstack/healthcheck-common@0.13.0
  - @checkstack/satellite-common@0.3.0
  - @checkstack/backend-api@0.13.1
  - @checkstack/healthcheck-backend@0.18.1
  - @checkstack/queue-api@0.2.15

## 0.2.16

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/healthcheck-common@0.12.0
  - @checkstack/healthcheck-backend@0.18.0
  - @checkstack/common@0.7.0
  - @checkstack/backend-api@0.13.0
  - @checkstack/satellite-common@0.2.1
  - @checkstack/signal-common@0.1.10
  - @checkstack/queue-api@0.2.14

## 0.2.15

### Patch Changes

- Updated dependencies [c4e7560]
  - @checkstack/healthcheck-backend@0.17.1

## 0.2.14

### Patch Changes

- Updated dependencies [298bf42]
  - @checkstack/healthcheck-backend@0.17.0

## 0.2.13

### Patch Changes

- Updated dependencies [9a320fe]
  - @checkstack/healthcheck-backend@0.16.5

## 0.2.12

### Patch Changes

- @checkstack/healthcheck-backend@0.16.4

## 0.2.11

### Patch Changes

- Updated dependencies [b53a40e]
  - @checkstack/healthcheck-backend@0.16.3

## 0.2.10

### Patch Changes

- Updated dependencies [57d54de]
  - @checkstack/healthcheck-backend@0.16.2

## 0.2.9

### Patch Changes

- @checkstack/healthcheck-backend@0.16.1

## 0.2.8

### Patch Changes

- Updated dependencies [80cbc51]
  - @checkstack/healthcheck-backend@0.16.0

## 0.2.7

### Patch Changes

- @checkstack/healthcheck-backend@0.15.1

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
