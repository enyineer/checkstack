---
"@checkstack/integration-backend": patch
"@checkstack/notification-backend": patch
"@checkstack/secrets-backend": patch
"@checkstack/script-packages-backend": patch
"@checkstack/automation-backend": patch
---

refactor: replace `env as unknown as EnvStash` double casts with module-scoped holders

The `init()` -> `afterPluginsReady()` bridging that stashed setup closures and
service handles as ad-hoc mutable properties on the framework `env` object via a
double cast (`env as unknown as EnvStash`) is replaced with typed module- or
register-scoped `let` holders, mirroring the existing pattern in
`healthcheck-backend` (`storedEmitHook`). No behavior or DB change; the holders
are pod-local setup state (never queryable current state), so they remain
scale-correct. This removes an unsafe, copy-paste-prone idiom from five core
plugins.
