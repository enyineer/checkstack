---
"@checkstack/backend": patch
"@checkstack/backend-api": minor
"@checkstack/test-utils-backend": patch
"@checkstack/notification-common": patch
"@checkstack/notification-backend": minor
"@checkstack/integration-webhook-backend": patch
"@checkstack/integration-script-backend": patch
"@checkstack/healthcheck-script-backend": patch
"@checkstack/healthcheck-tls-backend": patch
"@checkstack/notification-discord-backend": patch
"@checkstack/notification-slack-backend": patch
"@checkstack/notification-gotify-backend": patch
"@checkstack/notification-pushover-backend": patch
"@checkstack/notification-teams-backend": patch
"@checkstack/notification-telegram-backend": patch
"@checkstack/notification-webex-backend": patch
"@checkstack/notification-backstage-backend": patch
---

Dead-code audit cleanup and a small platform of shared notification helpers.

**Removed (dead code)**

- `core/backend/src/plugin-manager/deregistration-guard.ts` deleted. The exported `assertCanDeregister()` was never called and was a less-complete version of the dependents+isUninstallable checks already done inline by `previewUninstallOriginator` / `uninstallOriginator` in `plugin-manager-orchestrator.ts`.
- `createMockQueueFactory` deprecated alias removed from `@checkstack/test-utils-backend`. Use `createMockQueueManager` directly.

**New shared helpers**

- `@checkstack/backend-api` now exports `requestTimeoutMs()` — a Zod field builder for outbound HTTP request timeouts (1s..60s, default 10s). Replaces hand-rolled `configNumber({}).min(1000).max(60_000).default(10_000)` in `integration-webhook-backend`, `integration-script-backend`, and `healthcheck-script-backend`'s inline collector.
- `@checkstack/notification-common` now exports `SubjectStatusSchema` / `SubjectStatus`, mirroring the existing `ImportanceSchema`.
- `@checkstack/notification-backend` now exports:
  - `SUBJECT_STATUS_EMOJI` / `IMPORTANCE_EMOJI` — the shared status / importance emoji maps that Discord, Slack, Teams, Webex and Telegram previously each redefined inline.
  - `postJson(opts)` — a timeout-bounded `fetch` wrapper that handles non-2xx logging and error mapping for webhook-style POSTs. Returns `{ ok: true, response } | { ok: false, error }`.

**Migrated to shared helpers**

- Discord, Slack, Gotify, Pushover notification backends now use `postJson`. Outer try/catch + per-plugin error mapping deleted (~140 LOC).
- Discord, Slack, Teams, Telegram, Webex notification backends now use `IMPORTANCE_EMOJI`. Discord, Slack, Teams use `SUBJECT_STATUS_EMOJI`.
- Teams, Webex, Backstage, Telegram kept their inline fetch/Bot logic: their error strings surface server response bodies to operators, or the transport isn't raw `fetch` (Telegram uses `grammy`'s `Bot`).

**API surface tightening**

- Per-plugin test-only re-exports in 6 notification backends (Pushover, Gotify, Backstage, Slack, Discord, Teams) and the `CertificateInfo` interface in `healthcheck-tls-backend/strategy.ts` are now JSDoc-tagged `@internal`. No behaviour change; signals that downstream consumers must not depend on them.
