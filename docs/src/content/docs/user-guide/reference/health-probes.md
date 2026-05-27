---
title: "Health & Readiness Probes"
description: "The Checkstack backend exposes two HTTP probes that mirror the Kubernetes liveness/readiness model. Both endpoints bypass the init gate so orchestrators can poll the process even before plugins fin…"
---

The Checkstack backend exposes two HTTP probes that mirror the
Kubernetes liveness/readiness model. Both endpoints bypass the init gate
so orchestrators can poll the process even before plugins finish
loading.

## Endpoints

### `GET /.checkstack/health` - Liveness

Returns `200 { "status": "ok" }` as long as the process is responding.
Use this for liveness probes - failure means "the process is wedged,
restart it".

### `GET /.checkstack/ready` - Readiness

Returns `200` only when:

- Core init has completed (plugins loaded, routes registered), AND
- Every critical readiness probe registered by the platform and plugins
  is currently passing.

Otherwise returns `503` with `Retry-After`. Response body:

```json
{
  "ready": false,
  "checks": [
    { "name": "core.init", "critical": true, "ok": true, "durationMs": 0 },
    { "name": "queue.connected", "critical": true, "ok": false,
      "message": "queue pool not connected", "durationMs": 12 }
  ]
}
```

While init is in flight, the response is `{ "ready": false, "reason":
"initializing", "checks": [] }` with `Retry-After: 1`.
If init failed permanently (the process is about to exit), it returns
`{ "ready": false, "error": "<message>" }`.

## Plugin-Contributed Probes

Plugins register readiness probes via the
`coreServices.readinessRegistry` service. Probes registered during
`init` or `afterPluginsReady` are aggregated into `/.checkstack/ready` automatically.

```typescript
import { coreServices } from "@checkstack/backend-api";

env.registerInit({
  deps: {
    readiness: coreServices.readinessRegistry,
    // ...other deps
  },
  init: async ({ readiness, queueClient }) => {
    readiness.register({
      name: "queue.connected",
      critical: true, // default - non-critical probes don't block readiness
      check: async () => ({
        ok: queueClient.isConnected(),
        message: queueClient.isConnected()
          ? undefined
          : "queue pool not connected",
      }),
    });
  },
});
```

### Probe contract

- **`name`** - globally unique. Duplicates overwrite the prior probe
  with a warning. Convention: `<area>.<state>` (e.g. `queue.connected`,
  `auth.strategy-loaded`).
- **`critical`** - defaults to `true`. Critical probes failing →
  `ready: false`. Non-critical probes are reported in the response but
  don't affect overall readiness.
- **`check`** - async function returning `{ ok, message? }`. **Must
  return quickly** (target <1s). Long-running checks should cache their
  result in the background and read the cached value here, because
  `/.checkstack/ready` is hit by orchestrators on a tight loop.

### Failure handling

- A probe that throws is treated as `ok: false` and its error message
  is surfaced via the `error` field.
- All probes run in parallel - total `/.checkstack/ready` latency ≈ slowest probe.

## Init Lifecycle

The backend starts answering `/.checkstack/health` and `/.checkstack/ready` immediately at
process start, but holds all other requests until plugin init is
complete. This protects against the previously-observed race where an
early request would freeze Hono's matcher before plugin routes were
registered. See `core/backend/src/index.ts` for the gate
implementation.

If init throws, the process exits with code `1` so the supervisor
(docker/k8s) restarts cleanly - the backend never serves a
half-initialized state.
