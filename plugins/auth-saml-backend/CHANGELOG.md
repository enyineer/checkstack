# @checkstack/auth-saml-backend

## 0.1.6

### Patch Changes

- Updated dependencies [f676e11]
- Updated dependencies [48c2080]
  - @checkstack/common@0.6.2
  - @checkstack/backend-api@0.6.0
  - @checkstack/auth-backend@0.4.6
  - @checkstack/auth-common@0.5.5

## 0.1.5

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/auth-backend@0.4.5
  - @checkstack/auth-common@0.5.4
  - @checkstack/backend-api@0.5.2
  - @checkstack/common@0.6.1

## 0.1.4

### Patch Changes

- Updated dependencies [db1f56f]
  - @checkstack/common@0.6.0
  - @checkstack/auth-backend@0.4.4
  - @checkstack/auth-common@0.5.3
  - @checkstack/backend-api@0.5.1

## 0.1.3

### Patch Changes

- Updated dependencies [66a3963]
- Updated dependencies [66a3963]
  - @checkstack/auth-backend@0.4.3
  - @checkstack/backend-api@0.5.0

## 0.1.2

### Patch Changes

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/auth-common@0.5.2
  - @checkstack/backend-api@0.4.1
  - @checkstack/common@0.5.0
  - @checkstack/auth-backend@0.4.2

## 0.1.1

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
  - @checkstack/backend-api@0.4.0
  - @checkstack/common@0.4.0
  - @checkstack/auth-backend@0.4.1
  - @checkstack/auth-common@0.5.1

## 0.1.0

### Minor Changes

- 10aa9fb: Add SAML 2.0 SSO support

  - Added new `auth-saml-backend` plugin for SAML 2.0 Single Sign-On authentication
  - Supports SP-initiated SSO with configurable IdP metadata (URL or manual configuration)
  - Uses samlify library for SAML protocol handling
  - Configurable attribute mapping for user email/name extraction
  - Automatic user creation and updates via S2S Identity API
  - Added SAML redirect handling in LoginPage for seamless SSO flow

- d94121b: Add group-to-role mapping for SAML and LDAP authentication

  **Features:**

  - SAML and LDAP users can now be automatically assigned Checkstack roles based on their directory group memberships
  - Configure group mappings in the authentication strategy settings with dynamic role dropdowns
  - Managed role sync: roles configured in mappings are fully synchronized (added when user gains group, removed when user leaves group)
  - Unmanaged roles (manually assigned, not in any mapping) are preserved during sync
  - Optional default role for all users from a directory

  **Bug Fix:**

  - Fixed `x-options-resolver` not working for fields inside arrays with `.default([])` in DynamicForm schemas

### Patch Changes

- Updated dependencies [d94121b]
  - @checkstack/backend-api@0.3.3
  - @checkstack/auth-backend@0.4.0
  - @checkstack/auth-common@0.5.0
