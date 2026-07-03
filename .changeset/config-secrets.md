---
"@checkstack/backend-api": minor
"@checkstack/secrets-backend": minor
"@checkstack/secrets-common": minor
"@checkstack/common": minor
"@checkstack/integration-backend": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/satellite": minor
"@checkstack/satellite-backend": minor
"@checkstack/satellite-common": minor
"@checkstack/ui": minor
"@checkstack/healthcheck-ssh-backend": minor
"@checkstack/healthcheck-http-backend": minor
"@checkstack/healthcheck-mysql-backend": minor
"@checkstack/healthcheck-postgres-backend": minor
"@checkstack/healthcheck-redis-backend": minor
"@checkstack/healthcheck-rcon-backend": minor
"@checkstack/healthcheck-jenkins-backend": minor
"@checkstack/backend": patch
"@checkstack/ai-backend": patch
"@checkstack/integration-jira-backend": patch
"@checkstack/integration-teams-backend": patch
"@checkstack/integration-webex-backend": patch
---

Security: config secrets (health-check strategy/collector credentials such as
SSH passwords, DB credentials, HTTP auth, and integration connection
credentials) ride ONE shared, domain-agnostic extraction channel instead of
being stored as plaintext or re-implemented per plugin.

New primitive and shared service:

- `configSecret({ id })` (in `@checkstack/backend-api`) declares an
  extraction-channel secret keyed by a STABLE `id`, independent of field name or
  position, so renaming or reordering a field never orphans its value. Use it
  (not `configString({ "x-secret": true })`) for any credential whose config is
  relayed to a satellite, projected to AI, or diffed by GitOps. `validateSecretIds`
  rejects, at plugin registration, an `x-secret` field with no `id`, a duplicate
  `id`, or a secret nested in an un-keyable container (array / record / tuple /
  map) - so a mis-keyable schema fails boot rather than at run time.
- `ConfigSecretChannel` (in `@checkstack/secrets-backend`) is the single
  extract / inflate / collect / redact / merge / delete / prune implementation.
  Health-checks and integration connections both BIND it to their own scope
  (marker prefix + internal-secret key layout); neither re-implements the walk.

Lifecycle (both bindings):

- **Write**: an inline value is extracted into the encrypted internal secret
  store; the stored config keeps only an opaque marker. `${{ secrets.NAME }}`
  references are stored verbatim and resolve through the active backend (local
  or Vault) at run time.
- **Read**: configuration and connection reads strip `x-secret` values and
  internal markers while keeping `${{ secrets.NAME }}` references visible; the
  AI `getConfigurations` tool and create/update responses are redacted too. A
  value never reaches a browser or an AI model context.
- **Run**: the core executor inflates markers/references in memory just before
  the client is built. Satellites receive markers only and fetch values
  just-in-time over the authenticated WS channel, per run, never persisted, then
  fail CLOSED if any marker/reference survives resolution.
- **No orphan**: clearing a secret, removing a field/collector, swapping an
  inline value for a reference, updating a connection, or deleting a
  configuration/connection deletes the now-unreferenced internal secret. Cleanup
  is schema-free (scans markers by prefix) and best-effort on delete, so it works
  even when the owning plugin is uninstalled and never blocks a delete.
- **Forged-marker safe**: extract/inflate key each internal secret by the
  SCHEMA leaf's stable `id`, never by an id parsed out of a stored marker string,
  so a crafted marker can never resolve or delete another scope's secret.

Health-checks additionally get an idempotent, advisory-locked backfill that
moves pre-existing plaintext values into the internal store, and per-config-id
locking so concurrent writers across pods can never leave a dangling marker.
Integration connection credentials keep their released `__connref__:` marker
prefix and key layout (id equals the flat field name), so existing stored
connections are byte-compatible.

BREAKING CHANGES:

- Configuration and connection reads no longer include `x-secret` field values
  (clients must treat blank-on-save as keep-existing; the bundled editors
  already do).
- Satellites must be upgraded together with the core: an old satellite cannot
  resolve the markers a new core stores, so its credentialed checks fail until
  upgraded.
