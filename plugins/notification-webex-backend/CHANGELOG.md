# @checkstack/notification-webex-backend

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/backend-api@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/notification-backend@0.0.2

## 0.1.0

### Minor Changes

- 4c5aa9e: Add Webex notification strategy - sends alerts to users via Webex direct messages

  - Bot token configured by admin (long-lived tokens from developer.webex.com)
  - Users configure their Webex Person ID to receive notifications
  - Supports markdown formatting with importance emojis and action links
  - Includes admin and user setup instructions

### Patch Changes

- Updated dependencies [b4eb432]
- Updated dependencies [a65e002]
  - @checkstack/backend-api@1.1.0
  - @checkstack/notification-backend@0.1.2
  - @checkstack/common@0.2.0
