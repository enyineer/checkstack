# @checkstack/integration-teams-backend

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/backend-api@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/integration-backend@0.0.2

## 0.1.0

### Minor Changes

- 4c5aa9e: Add Microsoft Teams integration provider - sends events to Teams channels via Graph API

  - Connection schema for Azure AD App credentials (Tenant ID, Client ID, Client Secret)
  - Dynamic team/channel selection via Graph API
  - Adaptive Cards for rich event display
  - Client credentials flow for app-only authentication
  - Comprehensive documentation for Azure AD setup and permissions

### Patch Changes

- Updated dependencies [4c5aa9e]
- Updated dependencies [b4eb432]
- Updated dependencies [a65e002]
- Updated dependencies [a65e002]
  - @checkstack/integration-backend@0.1.0
  - @checkstack/backend-api@1.1.0
  - @checkstack/common@0.2.0
