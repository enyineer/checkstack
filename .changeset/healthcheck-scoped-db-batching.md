---
"@checkstack/backend-api": minor
"@checkstack/healthcheck-backend": patch
"@checkstack/dashboard-frontend": patch
---

Cut the per-tick database work of the health-check executor by batching
scoped-database queries, and fix a dashboard "Recent activity" rendering bug.

The scoped-database proxy has to wrap every standalone query in its own
transaction so `SET LOCAL search_path` applies to it, which means a hot path
issuing many sequential queries pays the `BEGIN` / `SET LOCAL` / `COMMIT`
round-trips once per query and checks a connection out that many times. Two
changes remove most of that overhead on the health-check path:

- **New `withScopedTransaction` helper (`@checkstack/backend-api`).** A reusable
  primitive for running several scoped queries under a SINGLE `SET LOCAL
  search_path` transaction, plus `ScopedTransaction` / `ScopedQueryRunner`
  types so a helper can accept either the scoped db or a transaction handle.
  Use it on any scoped-db hot path that issues 2+ queries in sequence.
- **`getSystemHealthStatus` is now batched.** It was a `1 + N` read fan-out (one
  associations query, then one run-window query per enabled check) run as `1 +
  N` separate proxy transactions. It now runs as ONE transaction. This is the
  hottest read on the platform - each check tick reads it several times, and the
  dashboard, RPC router, and AI system-signals all call it - so the reduction in
  transaction volume and connection churn is broad. The reads are also now a
  single consistent snapshot.
- **The executor's run + aggregate writes are batched.** Each persisted run
  previously issued the run `INSERT`, the aggregate `SELECT`, and the aggregate
  `UPSERT` as three separate proxy transactions; they now run in one
  transaction and commit atomically (the run and the aggregate it feeds can no
  longer be persisted apart).

Behaviour is unchanged: the derived health status, transition detection, and
signals are identical; only the number of database transactions per tick drops.

Also fixes a dashboard bug where the "Recent activity" feed generated React keys
from `configurationName` plus a millisecond timestamp, so results from different
systems sharing a check name that completed in the same millisecond collided on
one key and React mis-reconciled the list (visually duplicated/omitted entries).
Keys are now derived from the system, configuration, and environment ids.
