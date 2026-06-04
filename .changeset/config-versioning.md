---
"@checkstack/backend-api": minor
"@checkstack/integration-backend": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-http-backend": minor
"@checkstack/automation-backend": minor
"@checkstack/integration-script-backend": minor
"@checkstack/anomaly-backend": minor
"@checkstack/anomaly-common": minor
"@checkstack/notification-backend": minor
"@checkstack/auth-backend": minor
---

Harden config-versioning so stored configs always migrate-then-validate and broken migration chains fail fast at boot.

- `@checkstack/backend-api` `Versioned<T>` gains `parseAssumingV1` (migrate-from-v1 then validate leniently, runtime path), `parseStrictAssumingV1` (migrate then validate strictly, editor path), and `validateMigrationChainFromV1()`. A standalone pure helper `assertMigrationChainFromV1({ version, migrations })` is the single shared implementation behind the constructor guard and `validateMigrationChainFromV1`.
- `Versioned` now validates its own v1 -> `version` chain in the constructor, which runs at module import / plugin registration. A new `no-restricted-syntax` ESLint rule bans calling `parse` / `safeParse` / `parseAsync` / `strict` directly on a `Versioned`'s `.schema` member.
- Auth strategy migration chains are validated at the `betterAuthExtensionPoint.addStrategy` chokepoint (`@checkstack/auth-backend`).
- Automation action AND trigger configs migrate-then-validate (lenient at dispatch, strict in the editor validator, recursing into `choose`/`parallel`/`repeat`/`sequence` blocks). The `run_script` / `run_shell` action configs bump to `version: 2` dropping the removed `sandbox` key, fixing the editor's `Unrecognized key: sandbox` error.
- Anomaly read path now validates: `getAnomalyConfig` / `getAnomalyAssignmentConfig` run stored records through `Versioned.parseRecord`; `PartialAnomalySettingsSchema` moved to `@checkstack/anomaly-common`. Notification ConfigService reads thread the migrations argument, and per-strategy `userConfig` is migrate-then-validated before `send()`.
- gitops-apply migrate-then-validates authored health-check config; integration connection validation routes through `safeValidate`. The latent HTTP health-check `result` schema (at `version: 3` with no migrations) now ships a pass-through v1 -> v2 -> v3 chain.

BREAKING CHANGES (fail-fast at boot, intended):

- Any `Versioned` config with `version > 1` and an incomplete or non-contiguous migration chain now throws at construction (boot) instead of failing lazily on first read. This covers every `Versioned` instance repo-wide, including future plugin types. Out-of-tree plugins shipping such a config must add the missing migration step(s); all in-repo strategies already have complete chains.
- An auth strategy declaring `configVersion > 1` without a complete chain throws at registration.
- A trigger's per-automation config is now a versioned `config: Versioned<TConfig>` instead of a bare `configSchema?`. Plugins registering triggers with `configSchema:` must wrap it: `config: new Versioned({ version: 1, schema })`. The underlying schema stays reachable via `config.schema`; triggers without per-automation config are unaffected.

State and scale: all affected reads resolve from shared Postgres / in-process registries, so every pod sees the same migrated answer. No new framework-owned current-state store.

This is a beta minor.
