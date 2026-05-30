---
"@checkstack/secrets-common": minor
"@checkstack/secrets-backend": minor
"@checkstack/script-packages-backend": minor
"@checkstack/integration-backend": patch
---

Secrets platform Phase 5: internal-secret consolidation (registry token) + connection-credential leak hardening.

- New `internalSecretsRef`: platform-internal secrets (not user-managed
  named secrets) stored under a reserved `__internal__:` prefix, ALWAYS on
  the local (always-writable, AES-GCM) backend so internal writes never
  break when Vault is the active backend. Excluded from the user-facing
  Secrets list.
- The script-package registry auth token is consolidated onto
  `internalSecretsRef`. The `authSecretRef` column now holds a stable
  marker; a one-time, idempotent, parity-verified migration moves legacy
  inline ciphertext into the platform and only rewrites the column once the
  platform copy reads back identically (legacy value never dropped early).
  Resolution stays backward-compatible with legacy ciphertext.
- Integration: `createConnection` / `updateConnection` now return the
  redacted connection preview instead of echoing the submitted credential
  fields back in the response (leak hardening). Non-breaking — the frontend
  refetches the redacted list and ignores the returned preview.

NOTE: integration connection-credential STORAGE is intentionally NOT
migrated onto the secrets platform. Connection creds are co-mingled
secret/non-secret config stored per-provider via `ConfigService` (which
already uses the same AES-GCM crypto + per-field redaction); splitting them
out would require per-provider schema-walking and a lossy migration across
live integrations for no real gain. The `ConnectionStore` API + storage are
unchanged.
