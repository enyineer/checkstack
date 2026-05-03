---
"@checkstack/backend": patch
"@checkstack/backend-api": patch
---

fix: resilient startup routing + /health and /ready endpoints

Three fixes that together eliminate startup-race errors during boot and
hot-reload, plus a new readiness API for plugins.

1. **TrieRouter swap (root cause).** Hono's default `SmartRouter` freezes
   its matcher on the first request — any later `app.add()` throws
   `MESSAGE_MATCHER_IS_ALREADY_BUILT`. Plugins register routes during
   `init()` (and at runtime via `loadSinglePlugin`), so an early request
   during boot would silently lock the matcher with only the module-load
   routes, and every later route registration would fail. The backend
   now uses `TrieRouter`, which is incremental — routes can be added at
   any time, including after thousands of requests have been served.
   This also future-proofs runtime plugin install.

2. **Init gating + fail-loud.** Non-bypass requests now `await` an
   `initPromise` (with a 30s timeout that returns 503 + Retry-After) so
   no traffic reaches Hono before plugins finish registering routes.
   Init failures crash the process via `process.exit(1)` so docker/k8s
   restart cleanly instead of silently serving a half-initialized
   backend.

3. **`/assets/*` fall-through.** The production frontend asset handler
   now calls `next()` instead of `c.notFound()` on miss, so
   plugin-asset routes registered later (`/assets/plugins/:pluginName/*`)
   actually get a chance to match.

### New: platform endpoints under `/.checkstack/*`

- `GET /.checkstack/health` — liveness, always 200 once the process is up.
- `GET /.checkstack/ready` — readiness, 503 until init completes and all
  critical probes pass; 200 otherwise. Returns `{ ready, checks: [...] }`
  with per-probe status, message/error and duration.

The leading `.checkstack/` prefix namespaces platform-level endpoints
away from plugin `/api/*`, runtime frontend assets, and the SPA wildcard,
leaving room for additional operator endpoints in the future.

### New: plugin readiness API

Plugins can contribute readiness probes via the new
`coreServices.readinessRegistry` service:

```ts
registerInit({
  deps: { readiness: coreServices.readinessRegistry },
  async init({ readiness }) {
    readiness.register({
      name: "queue.connected",
      critical: true,
      check: async () => ({
        ok: pool.isConnected(),
        message: pool.isConnected() ? undefined : "queue pool not connected",
      }),
    });
  },
});
```

Probes run in parallel, throwing probes are reported as `ok: false`,
and non-critical probes don't block readiness.
