---
"@checkstack/ui": minor
---

Script health-check editors now surface the assigned environment.

Inline TS/JS health checks autocomplete `context.environment` (the optional
`{ id, name, fields }` the run resolves to), with `fields` typed
`Record<string, unknown>` so values are narrowed before use (the API/GitOps
write path allows arbitrary JSON, not just the UI's string key/value pairs).
Shell health checks now suggest the `CHECKSTACK_ENV_ID` / `CHECKSTACK_ENV_NAME`
run-context variables (with the per-field `CHECKSTACK_ENV_<FIELD>` naming
convention documented inline). The runtime already injected these; this only
adds the editor type definitions and `$`-completion hints, and flows through to
the regenerated `@checkstack/sdk/healthcheck` types.
