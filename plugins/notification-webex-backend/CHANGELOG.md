# @checkmate-monitor/notification-webex-backend

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
  - @checkmate-monitor/backend-api@1.1.0
  - @checkmate-monitor/notification-backend@0.1.2
  - @checkmate-monitor/common@0.2.0
