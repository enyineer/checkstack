# Performance Optimization — Verified Outcome

This branch was audited finding-by-finding (parallel verification agents +
firsthand checks). The original draft's headline narrative — a lockPool
"exhaustion cascade" where 67% of check environments fail — was **not real**:
environments run **sequentially** per job (`queue-executor.ts`, a `for...of`
loop with `await` in the body), so a job holds at most one advisory-lock
connection at a time and the "30 concurrent critical sections" math does not
apply. The genuine cost the audit confirmed is the **scoped-database proxy
wrapping every query in its own `BEGIN → SET LOCAL → COMMIT` transaction**, and
the health-check read path issuing that transaction far more often than needed.

## Shipped

- **`withScopedTransaction` helper + `ScopedTransaction` / `ScopedQueryRunner`
  types** (`@checkstack/backend-api`). Reusable primitive to run several scoped
  queries under ONE `SET LOCAL search_path`. Documented in the Drizzle-schema
  developer guide.
- **`getSystemHealthStatus` batched** (`healthcheck-backend`). Was a `1 + N`
  read run as `1 + N` proxy transactions; now ONE transaction. This is the
  dominant per-tick read (each tick reads it several times; router / dashboard /
  AI signals also call it), so it is the highest-leverage safe win.
- **Executor run + aggregate writes batched.** The run `INSERT` + aggregate
  `SELECT` + aggregate `UPSERT` (three proxy transactions) now run in one
  transaction and commit atomically.
- **F16 dashboard "Recent activity" duplicate-key fix** — the one correct change
  from the original draft. Kept.
- **`withTransactionMock` test helper** so mock DBs match the scoped-db
  `.transaction()` contract.

Behaviour is unchanged (identical status, transitions, signals); only the number
of DB transactions per tick drops.

## Reverted (verified broken / net-negative / inert)

- **F1 scan cursor** — broke priority ordering; **failed a pre-existing test**
  the draft claimed passed.
- **F6 enqueue dedup** — dead code (`dedupeKey` is not on the `Queue<T>`
  interface and no caller passes it) with a latent contract bug (returned a
  phantom job id on a dedup "hit").
- **F8 template render cache** — net-negative (the `JSON.stringify` cache key
  cost more than the render fast-path it replaced) and unsafe: stale
  `{{ system.name }}` / `{{ check.name }}` indefinitely, and resolved plaintext
  secrets held in a never-cleared module-level `Map`.
- **F11 environment fan-out gate** — a pure no-op (the loop stayed sequential;
  the "concurrency slot" never engaged) plus a leftover per-iteration debug log.
- **Metrics / OpenTelemetry layer** — 8 lint errors (CI was red), an unbounded
  histogram memory leak, invalid Prometheus exposition, an uncleared
  `setInterval`, an unauthenticated `/.checkstack/metrics` endpoint, and a dead
  `@opentelemetry/api` dependency.
- **F7 smart heartbeat, F9 collector throttle, F14 system-name cache** — dropped
  as marginal-and-risky: F7 is practically inert (its only behavioural delta is
  unreachable) and untestable in this harness; F9's hardcoded cap of 3 risks
  latency regressions on many-collector checks; F14's cross-pod name divergence
  is a scale-correctness smell. None survive cost/benefit versus the batching
  work above.

## Not pursued (correctly)

- **Eliminating the lockPool / JS-mutex or Redis-SETNX locking** — unsafe. The
  advisory lock is a cross-process guarantee (the platform runs N pods on one
  Postgres); a per-process JS mutex cannot replace it, and the SETNX sketch
  lacked fencing. The two-pool design is deliberate and documented in `db.ts`.
- **F15 "read prev from the framework snapshot"** — the framework reads `prev`
  INSIDE the advisory lock for correct multi-config serialization; memoizing a
  pre-lock read across that boundary is unsafe. F15's benefit is instead
  captured safely by batching `getSystemHealthStatus` itself (above), which also
  speeds the framework's own prev read.

_This file is a working record and is not intended to be committed._
