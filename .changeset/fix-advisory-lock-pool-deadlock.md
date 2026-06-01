---
"@checkstack/backend": minor
"@checkstack/backend-api": minor
"@checkstack/incident-backend": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/automation-backend": minor
---

fix(backend): give advisory locks a dedicated connection pool to prevent pool-starvation deadlock

Both the session-lock service and `withXactLock` HOLD a Postgres connection for
the lock's whole lifetime while the gated work runs on a *different* connection.
Both lock and work were drawing from the single shared `adminPool` (which, with
no explicit config, defaulted to `max: 10` and `connectionTimeoutMillis: 0` -
wait forever). Under concurrency >= pool size, every slot became a lock-holding
connection waiting for a work connection that could never free up: a permanent
deadlock. It surfaced as all connections stuck `idle in transaction` on
`pg_advisory_xact_lock` and every API request hanging into an upstream 502,
only after the server had been running long enough to hit that concurrency
(e.g. a burst of health-check evaluations or incident dedups).

Advisory locks now run on a dedicated `lockPool`, separate from `adminPool`, so
the acquire graph is acyclic (`lockPool -> adminPool`, never back) and the
deadlock class is impossible. `AdvisoryLockService` gains a pooled
`withXactLock({ key, fn })` method (lock on the lock pool, work on the admin
pool); healthcheck's per-system serializer, incident's dedup-create, and the
automation single-mode concurrency lock now use it. The deadlock-prone
standalone `withXactLock({ db, ... })` helper is REMOVED.

Both pools are explicitly configured with `connectionTimeoutMillis` so any
future exhaustion fails fast and self-heals instead of hanging, and both get a
pool-level `error` handler (an idle pooled client whose backend dies otherwise
crashes the pod). The lock pool additionally sets
`idle_in_transaction_session_timeout` and `lock_timeout` so a stalled critical
section is reaped server-side (auto-releasing the lock) rather than stranding a
key forever. The advisory-lock service also now removes its per-client error
listener on release (it previously leaked one listener per acquisition on each
reused pooled connection - an unbounded `MaxListenersExceeded` leak).

New env vars (all optional): `DATABASE_POOL_MAX` (default 20),
`DATABASE_LOCK_POOL_MAX` (default 10), `DATABASE_POOL_CONNECTION_TIMEOUT_MS`
(default 10000), `DATABASE_POOL_IDLE_TIMEOUT_MS` (default 30000),
`DATABASE_LOCK_IDLE_TX_TIMEOUT_MS` (default 30000), `DATABASE_LOCK_TIMEOUT_MS`
(default 30000). Size pools off
`N_pods * (DATABASE_POOL_MAX + DATABASE_LOCK_POOL_MAX) <= max_connections`.

BREAKING CHANGE: the standalone `withXactLock({ db, key, fn })` export is
removed - use `coreServices.advisoryLock.withXactLock({ key, fn })` instead.
`IncidentService`'s constructor now requires an `AdvisoryLockService` as its
second argument, and the healthcheck `createHealthEntitySerializer` /
`executeHealthCheckJob` / `setupHealthCheckWorker` helpers take `advisoryLock`
instead of `db` for the serializer.
