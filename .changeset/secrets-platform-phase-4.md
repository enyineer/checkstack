---
"@checkstack/secrets-backend-vault": minor
"@checkstack/secrets-common": minor
"@checkstack/secrets-backend": minor
"@checkstack/secrets-frontend": minor
---

Secrets platform Phase 4: HashiCorp Vault backend + backend selection.

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
