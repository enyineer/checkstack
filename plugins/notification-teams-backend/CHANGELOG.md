# @checkstack/notification-teams-backend

## 0.0.3

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/backend-api@0.1.0
  - @checkstack/notification-backend@0.0.3
  - @checkstack/common@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/backend-api@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/notification-backend@0.0.2

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
  - @checkstack/backend-api@1.1.0
  - @checkstack/notification-backend@0.1.2
  - @checkstack/common@0.2.0
