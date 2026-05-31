---
"@checkstack/backend-api": minor
"@checkstack/automation-backend": minor
"@checkstack/backend": minor
---

Fix automation provider actions and `secretEnv` script actions throwing in production.

The automation dispatch engine resolved provider-action dependencies (the integration connection store, the secret resolver) through a `getService` that was a throwing stub, so Jira / Teams / Webex actions and `secretEnv` script actions threw at execute time in production. The whole dispatch test suite stubbed `getService`, so the break was invisible.

Root cause: the plugin `env` exposed `registerService` but no resolver, so the dispatch path (the only context that resolves arbitrary cross-plugin refs outside an RPC handler) had nothing real to call.

Changes:

- `@checkstack/backend-api`: add `getService<S>(ref: ServiceRef<S>): Promise<S>` to the plugin `env` (`BackendPluginRegistry`). It resolves a service registered by any plugin through the real `ServiceRegistry` using the calling plugin's identity, and throws a clear error if the ref is not registered (never silently `undefined`). **NEW PLUGIN-AUTHOR CONTRACT**: `env.getService` is now available to resolve arbitrary cross-plugin service refs at init / afterPluginsReady time.
- `@checkstack/backend`: implement `env.getService` in both the plugin loader and the runtime single-plugin registration path, backed by `ServiceRegistry.get(ref, { pluginId })`.
- `@checkstack/automation-backend`: wire the dispatch `getService` to `env.getService` (was a throwing stub). This also activates run-wide provider-credential masking, because resolving the connection store / secret resolver now flows through the run's masking interceptor.

Also fixes a test-only seam where the `core/backend` test preload registered a no-op `registerRouter`, silently disabling oRPC router registration across the suite.
