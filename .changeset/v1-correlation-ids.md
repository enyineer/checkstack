---
"@checkstack/backend-api": minor
"@checkstack/backend": patch
"@checkstack/scripts": patch
"@checkstack/announcement-backend": patch
"@checkstack/anomaly-backend": patch
"@checkstack/auth-backend": patch
"@checkstack/cache-backend": patch
"@checkstack/catalog-backend": patch
"@checkstack/command-backend": patch
"@checkstack/dependency-backend": patch
"@checkstack/gitops-backend": patch
"@checkstack/healthcheck-backend": patch
"@checkstack/incident-backend": patch
"@checkstack/integration-backend": patch
"@checkstack/maintenance-backend": patch
"@checkstack/notification-backend": patch
"@checkstack/queue-backend": patch
"@checkstack/satellite-backend": patch
"@checkstack/slo-backend": patch
"@checkstack/theme-backend": patch
"@checkstack/tips-backend": patch
---

Add `correlationMiddleware` to `@checkstack/backend-api` and apply it
to every plugin/core router so each request carries a stable
`x-correlation-id` (read from the inbound header, or freshly minted
via `crypto.randomUUID()` when absent) and an auto-injected child
logger bound with `{ correlationId, pluginId, userId? }`. The ID is
echoed back on the response header so the caller can correlate their
client-side trace to the server logs.

The `Logger` interface in `@checkstack/backend-api` now formally
documents the structured-metadata convention (`logger.info("msg",
{ ...meta })`) alongside the long-standing varargs shape. Winston's
splat handling already routes both shapes through the same vararg
slot, so existing call sites are unaffected. A new optional
`Logger.child(meta)` method captures the metadata-binding contract the
new middleware relies on; production loggers always implement it,
minimal test mocks may omit it (the middleware falls back gracefully).

`RpcContext` grew two optional `Headers` bags, `requestHeaders` and
`responseHeaders`, populated by the outer Hono `/api/*` and `/rest/*`
handlers in `@checkstack/backend`. They are write-through observation
points for middleware; an `RpcContext` constructed without them (S2S
clients, tests) keeps working — the echo is a silent no-op and the ID
is still bound onto the child logger for server-side correlation.

The scaffolding template in `@checkstack/scripts` was updated so any
new plugin generated via `bun run create` wires the middleware in the
expected `.use(correlationMiddleware).use(autoAuthMiddleware)` order
out of the box.
