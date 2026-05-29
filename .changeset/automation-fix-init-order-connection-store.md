---
"@checkstack/integration-jira-backend": patch
"@checkstack/integration-teams-backend": patch
"@checkstack/integration-webex-backend": patch
---

fix(integration): resolve `connectionStoreRef` lazily inside action `execute`

The Phase 6/7/8 refactor wired every integration backend's
`registerInit` deps to include `connectionStore: connectionStoreRef`,
expecting `integration-backend` to register the service before the
sort. But `integration-backend` calls `env.registerService(connection
StoreRef, ...)` from inside its own `init()`, not at `register()`
time — so at topological-sort time the `providedBy` map doesn't know
the service exists yet, and the sort can put a consumer (e.g.
`integration-teams`) ahead of `integration-backend`. The dev server
then fails at boot with:

> Service 'integration.connectionStore' not found for plugin
> 'integration-teams'

This change drops the init-time dep from every integration plugin and
resolves the connection store **lazily at action-execute time** via
`context.getService(connectionStoreRef)`. By the time any action's
`execute` runs, every plugin has finished init + afterPluginsReady,
so the service is always available. Tests updated to thread a mock
store through a typed `getService` stub in the action context.

No behaviour change at runtime — the actions hit the connection store
at the same moment they always did (just inside `execute` rather than
through a captured init-time closure).
