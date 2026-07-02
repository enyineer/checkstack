---
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/satellite-common": minor
"@checkstack/satellite-backend": minor
"@checkstack/satellite": minor
---

Security: health-check config secrets (`x-secret` strategy/collector fields
such as SSH passwords, DB credentials, HTTP auth) were stored as plaintext
JSONB and returned verbatim to every reader - the UI editor, the AI
`getConfigurations` tool, and satellites. They now flow through the
platform's one secrets channel (the integration-connection pattern):

- **Write**: an inline value is extracted into the encrypted internal secret
  store; the stored row holds only an opaque marker. `${{ secrets.NAME }}`
  references are stored as-is and resolve at run time (GitOps applies now
  persist the reference, not the resolved value).
- **Read**: `getConfiguration`/`getConfigurations` and the create/update
  responses strip `x-secret` fields entirely. The editor treats a blank
  secret as "keep the stored value" (restored server-side before validation
  and re-extraction on update).
- **Run**: the core executor inflates markers/references in memory just
  before `createClient`. Satellites receive assignments carrying markers
  only and fetch values just-in-time over the authenticated WS channel
  (new `request_config_secrets`/`config_secrets` protocol messages), per
  run, never persisted.
- **Backfill**: an idempotent, advisory-locked boot job moves existing
  plaintext values into the internal store.

BREAKING CHANGES: configuration reads no longer include `x-secret` field
values (clients must treat blank-on-save as keep-existing - the bundled
editor already does). Satellites must be updated together with the core:
an old satellite cannot resolve the markers new cores store, so its
credentialed checks would fail until upgraded.
