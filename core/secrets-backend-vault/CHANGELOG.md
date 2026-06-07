# @checkstack/secrets-backend-vault

## 0.1.7

### Patch Changes

- Updated dependencies [0626782]
- Updated dependencies [56e7c75]
  - @checkstack/backend-api@0.21.5
  - @checkstack/common@0.15.0
  - @checkstack/secrets-common@0.2.3
  - @checkstack/secrets-backend@0.2.5

## 0.1.6

### Patch Changes

- Updated dependencies [b50916d]
  - @checkstack/backend-api@0.21.4
  - @checkstack/secrets-backend@0.2.4

## 0.1.5

### Patch Changes

- @checkstack/backend-api@0.21.3
- @checkstack/common@0.14.1
- @checkstack/secrets-backend@0.2.3
- @checkstack/secrets-common@0.2.2

## 0.1.4

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/backend-api@0.21.2
  - @checkstack/secrets-backend@0.2.2
  - @checkstack/secrets-common@0.2.2

## 0.1.3

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/backend-api@0.21.1
  - @checkstack/secrets-backend@0.2.1
  - @checkstack/secrets-common@0.2.1

## 0.1.2

### Patch Changes

- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
  - @checkstack/backend-api@0.21.0
  - @checkstack/common@0.13.0
  - @checkstack/secrets-backend@0.2.0
  - @checkstack/secrets-common@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [a57f7db]
  - @checkstack/backend-api@0.20.0
  - @checkstack/secrets-backend@0.1.1

## 0.1.0

### Minor Changes

- 270ef29: Secrets platform Phase 4: HashiCorp Vault backend + backend selection.

  - New `@checkstack/secrets-backend-vault`: a read-through `SecretBackend`
    against Vault. Token, AppRole, and OIDC/JWT auth (session cached to the
    lease TTL, capped); KV v2 reads mapped via the backend's own
    `secret_index` table (name → path/key); read-through value cache with a
    capped TTL (rotated values re-read). `list()` returns metadata only,
    never values. Minimal typed HTTP client (no extra dependency), injectable
    fetch for testing.
  - Backend selection: the active backend is persisted via `ConfigService`
    and switchable in Settings → Secrets; switching re-routes resolution.
    New `setBackendConfig` / `testBackend` RPCs (manage-gated, status-only)
    and `getBackendConfig` now returns Vault connection metadata
    (`hasCredential`, never the credential). `SecretBackend` gains optional
    `test` / `configure` / `getConfigMeta`.
  - The Vault auth credential is stored as an `x-secret` config field
    (encrypted at rest with the AES-GCM master key, redacted on read) —
    bootstrapping it WITHOUT putting it in Vault. It is write-only over the
    API and never logged.
  - Admin UI: backend selector + Vault connection form + "Test connection".

  Satellite-direct-Vault (a satellite reading Vault itself) is deferred to a
  follow-up; core-mediated delivery already routes through the Vault backend.

### Patch Changes

- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
  - @checkstack/backend-api@0.19.0
  - @checkstack/secrets-backend@0.1.0
  - @checkstack/secrets-common@0.1.0
