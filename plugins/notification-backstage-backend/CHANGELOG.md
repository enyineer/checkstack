# @checkstack/notification-backstage-backend

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
