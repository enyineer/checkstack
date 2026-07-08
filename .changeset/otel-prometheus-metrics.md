---
"@checkstack/backend-api": minor
"@checkstack/backend": minor
"@checkstack/healthcheck-backend": patch
"@checkstack/queue-memory-backend": patch
---

Add opt-in OpenTelemetry metrics with a Prometheus exporter so a performance
investigation can be grounded in real numbers from a running instance instead of
guesses.

The layer is **off by default and free when off**: the instruments are OTel
no-ops until a `MeterProvider` is registered, so the hot paths pay nothing until
you opt in.

- **`@checkstack/backend-api` gains an `instrumentation` module** exporting lazy,
  memoized instrument accessors any plugin can record through:
  `dbTransactionsCounter`, `dbQueriesCounter`, `healthcheckExecutionHistogram`,
  `healthcheckPhaseHistogram`, `queueEnqueuedCounter`, `queueProcessedCounter`.
  Each looks up its instrument once and is a no-op until the host registers a
  provider, so callers can record unconditionally.
- **`@checkstack/backend` owns the SDK bootstrap.** `startMetrics()` registers a
  global `MeterProvider` + Prometheus exporter when `CHECKSTACK_METRICS_ENABLED`
  is set (host `127.0.0.1`, port `9464` by default, both overridable via
  `CHECKSTACK_METRICS_HOST` / `CHECKSTACK_METRICS_PORT`). The exporter runs its
  OWN HTTP server, NOT a route on the app, so it carries no app-auth surface. It
  also registers host-owned observable instruments:
  `checkstack.db.pool.connections` (admin/lock pool active/idle/waiting) and
  `checkstack.runtime.event_loop_delay` (setInterval-drift histogram = JS-thread
  block time).
- **The scoped-DB proxy records DB transactions/queries per plugin schema**, so
  `db_transactions_total` minus `db_queries_total` per schema is exactly the
  number of batched transactions - a live check that `withScopedTransaction`
  batching is taking effect.
- **The health-check executor records execution + per-phase histograms**
  (`connect`, `wait`, ...) so a high `connect` p95 with a low `wait` points at
  connection establishment rather than a slow target or a CPU-bound platform.
- **The in-memory queue records enqueued/processed counters** per queue and
  status.

No behaviour changes when disabled. Enable with `CHECKSTACK_METRICS_ENABLED=1`
and scrape `http://127.0.0.1:9464/metrics`. See the backend observability guide
for the full metric list and interpretation.
