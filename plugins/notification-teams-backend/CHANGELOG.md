# @checkmate-monitor/notification-teams-backend

## 0.1.0

### Minor Changes

- 4c5aa9e: Add Microsoft Teams notification strategy - sends alerts to users via OAuth/Graph API

  - Admin configures Azure AD app credentials (Tenant ID, Client ID, Client Secret)
  - Users link their Microsoft account via OAuth flow
  - Messages sent as Adaptive Cards to 1:1 chats via Graph API
  - Supports importance-based coloring and action buttons
  - Includes detailed admin setup instructions for Azure AD configuration

### Patch Changes

- Updated dependencies [b4eb432]
- Updated dependencies [a65e002]
  - @checkmate-monitor/backend-api@1.1.0
  - @checkmate-monitor/notification-backend@0.1.2
  - @checkmate-monitor/common@0.2.0
