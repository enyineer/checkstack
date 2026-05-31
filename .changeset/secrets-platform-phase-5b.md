---
"@checkstack/integration-backend": minor
"@checkstack/secrets-backend": minor
---

Secrets platform Phase 5b: route integration connection credentials through the ONE secrets channel.

Connection credentials now resolve through the same secrets channel as
everything else, so a credential can originate from Vault and there is no
parallel credential-resolution code to drift. Two entry forms, both walked
by the shared `walkSecretFields` machinery (acting only on the provider
`connectionSchema`'s `x-secret` fields):

- Reference form: a `${{ secrets.NAME }}` template resolves through the
  ACTIVE backend (local or Vault) via `secretResolverRef`.
- Inline form: an operator-typed value is extracted into an internal
  secret on the local backend; the stored config keeps only a reference
  marker, resolved via `internalSecretsRef`.

The `ConnectionStore` public API is unchanged: `listConnections` /
`getConnection` stay redacted; `getConnectionWithCredentials` inflates via
the unified channel. A one-time, idempotent, parity-verified, REVERSIBLE
migration (backup ConfigService entry per connection; rewrites only after
the platform copy reads back identically) moves existing inline
credentials onto the platform without breaking live connections.

`secrets-backend` exports `walkSecretFields` (the shared schema-walk behind
`resolveSecretsBySchema`, reused for the migration extract + inflate).

BREAKING CHANGES: a connection's stored credential fields may now hold a
`${{ secrets.NAME }}` reference or an internal-reference marker instead of
an inline value. Resolution is transparent (`getConnectionWithCredentials`
returns the same plaintext); a legacy inline value still resolves until the
one-time migration converts it.
