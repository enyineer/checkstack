# @checkstack/notification-backstage-backend

## 0.1.11

### Patch Changes

- Updated dependencies [f676e11]
- Updated dependencies [48c2080]
  - @checkstack/common@0.6.2
  - @checkstack/backend-api@0.6.0
  - @checkstack/notification-backend@0.1.10

## 0.1.10

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/backend-api@0.5.2
  - @checkstack/common@0.6.1
  - @checkstack/notification-backend@0.1.9

## 0.1.9

### Patch Changes

- Updated dependencies [db1f56f]
  - @checkstack/common@0.6.0
  - @checkstack/backend-api@0.5.1
  - @checkstack/notification-backend@0.1.8

## 0.1.8

### Patch Changes

- Updated dependencies [66a3963]
- Updated dependencies [66a3963]
  - @checkstack/notification-backend@0.1.7
  - @checkstack/backend-api@0.5.0

## 0.1.7

### Patch Changes

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/backend-api@0.4.1
  - @checkstack/common@0.5.0
  - @checkstack/notification-backend@0.1.6

## 0.1.6

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
  - @checkstack/backend-api@0.4.0
  - @checkstack/common@0.4.0
  - @checkstack/notification-backend@0.1.5

## 0.1.5

### Patch Changes

- Updated dependencies [d94121b]
  - @checkstack/backend-api@0.3.3
  - @checkstack/notification-backend@0.1.4

## 0.1.4

### Patch Changes

- @checkstack/notification-backend@0.1.3

## 0.1.3

### Patch Changes

- Updated dependencies [7a23261]
  - @checkstack/common@0.3.0
  - @checkstack/backend-api@0.3.2
  - @checkstack/notification-backend@0.1.2

## 0.1.2

### Patch Changes

- @checkstack/backend-api@0.3.1
- @checkstack/notification-backend@0.1.1

## 0.1.1

### Patch Changes

- Updated dependencies [9faec1f]
- Updated dependencies [827b286]
- Updated dependencies [f533141]
- Updated dependencies [aa4a8ab]
  - @checkstack/backend-api@0.3.0
  - @checkstack/common@0.2.0
  - @checkstack/notification-backend@0.1.0

## 0.1.0

### Minor Changes

- 97c5a6b: Add Backstage notification provider plugin

  This new plugin enables forwarding Checkstack notifications to external Backstage instances via the Backstage Notifications REST API.

  **Features:**

  - Admin configuration for Backstage instance URL and API token
  - User configuration for custom entity reference (e.g., `user:default/john.doe`)
  - Automatic entity reference generation from user email when not specified
  - Severity mapping from Checkstack importance levels to Backstage severity
  - Full admin and user setup instructions

### Patch Changes

- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
  - @checkstack/backend-api@0.2.0
  - @checkstack/common@0.1.0
  - @checkstack/notification-backend@0.0.4
