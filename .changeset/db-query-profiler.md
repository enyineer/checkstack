---
"@checkstack/backend-api": patch
"@checkstack/backend": patch
"@checkstack/ai-backend": patch
---

Add a database query profiler to the OpenTelemetry/Prometheus metrics layer.

Two new scoped-db duration histograms answer "how long do queries take, and how long is a connection held", labelled by BOUNDED attributes only:

- `checkstack.db.query.duration` (`schema`, `operation`) — wall-clock of a standalone scoped query (`BEGIN` + `SET LOCAL search_path` + query + `COMMIT`), recorded at the scoped-db proxy seam for every `.then`/`.execute`/`$count` path.
- `checkstack.db.transaction.duration` (`schema`) — connection-hold time of a `withScopedTransaction` batch, the guard against a batch pinning a pooled connection (e.g. slow non-DB work wrapped in a transaction).

For the per-statement drill-down (which exact SQL is hot, not just which operation kind), the host optionally exports Postgres' `pg_stat_statements` view: `checkstack.db.statements.{calls,exec_time_ms,rows}` counters plus a `mean_exec_time_ms` gauge, bounded to the top-N statements by total execution time (`CHECKSTACK_DB_STATEMENTS_TOP_N`, default 25). It is self-disabling: when metrics are enabled the backend probes the connected database once and, if `pg_stat_statements` is not active (extension absent or the role cannot read the view), registers nothing and logs a single info line — a clean no-op with zero cost. The whole layer remains off unless `CHECKSTACK_METRICS_ENABLED` is set.

The `@checkstack/ai-backend` bump is the regenerated docs search index reflecting the expanded observability page.
