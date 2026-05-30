---
"@checkstack/healthcheck-script-backend": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-common": minor
"@checkstack/satellite-common": minor
"@checkstack/satellite": minor
"@checkstack/backend-api": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/automation-frontend": minor
"@checkstack/ui": minor
---

feat(healthcheck): expose check + system run-context to script collectors

Script health checks can now read which check and system a run is for.
Previously shell scripts got only a curated env whitelist and inline
scripts only `context.config`, so a script had no built-in way to know
its own check name or the system it was checking.

- `@checkstack/backend-api`: new `CollectorRunContext` type
  (`{ check: { id, name, intervalSeconds }, system: { id, name } }`) and
  an optional `runContext` param on `CollectorStrategy.execute`. Optional,
  so existing collector implementations are unaffected.
- Shell-script collector: injects reserved `CHECKSTACK_CHECK_ID`,
  `CHECKSTACK_CHECK_NAME`, `CHECKSTACK_CHECK_INTERVAL_SECONDS`,
  `CHECKSTACK_SYSTEM_ID`, `CHECKSTACK_SYSTEM_NAME` env vars (user-supplied
  `env` still wins on collision).
- Inline-script collector: exposes `context.check` and `context.system`
  alongside `context.config`; the inline-script editor now types them for
  autocomplete.
- Shell editors (health-check collectors and automation shell actions) now
  also suggest the user's own `env` (JSON) keys as `$NAME` completions, via
  the new exported `customShellEnvVars` helper. Keys that aren't valid shell
  identifiers are omitted.
- Fix: the Typefox `CodeEditor` captured a stale `onChange` at editor start,
  so editing one `DynamicForm` field reverted sibling fields changed since
  mount (e.g. typing in a shell `script` field wiped an unsaved `env` value,
  or deleted a sibling automation action added after mount). The change
  handler now routes through a ref to the current `onChange`.
- Fix: focusing a JSON editor threw "LanguageStatusService.addStatus is not
  supported" because the standalone service set omitted `ILanguageStatusService`.
  That one service is now registered via `serviceOverrides`.
- Fix: the automation trigger card nested a `<Badge>` (a `<div>`) inside a
  `<p>`, producing a `validateDOMNesting` warning. Switched the wrapper to a
  `<div>`.
- Local runs (`queue-executor`) and satellite runs both populate the
  context. `SatelliteAssignment` (and the `getAssignmentsForSatellite`
  RPC output) gained optional `configName` / `systemName` so the metadata
  reaches satellite-side execution; `HealthCheckService` resolves the
  system name via the catalog client.

BREAKING CHANGE: `createHealthCheckRouter` now requires a `catalogClient`
option (used to resolve system names for satellite assignments). Update
call sites to pass the catalog RPC client.
