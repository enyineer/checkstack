---
"@checkstack/signal-backend": minor
"@checkstack/backend": minor
---

Stop the spurious "Plugin unknown is not using new API. Skipping." startup warning.

`@checkstack/signal-backend` is a host-consumed library (the backend imports `SignalServiceImpl` and `createWebSocketHandler` directly), but its `package.json` declared `checkstack.type: "backend"`, so plugin discovery inserted it as a runtime backend plugin and the loader tried to read a default `register()` export it does not have - logging the offending package as the literal `unknown`.

- Reclassify `@checkstack/signal-backend` to `checkstack.type: "tooling"` (like `@checkstack/backend-api`), so it is no longer discovered or registered as a backend plugin. No runtime behavior change - the SignalService and WebSocket handler are still instantiated and registered directly by the host backend.
- Harden the loader's skip diagnostic so it can never render `unknown`: it resolves the offending plugin by its database-row package name (falling back to the on-disk path) and tells operators to set `checkstack.type` to `"tooling"` for host-consumed libraries.

This is a beta minor.
