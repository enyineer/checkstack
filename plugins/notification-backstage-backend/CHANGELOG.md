# @checkstack/notification-backstage-backend

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
