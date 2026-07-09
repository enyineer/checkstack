---
"@checkstack/healthcheck-backend": minor
---

perf(healthcheck): cache system health status on the shared distributed cache with per-check-vector invalidation

The per-system derived health status (`getSystemHealthStatus`) is an N+1 over
`health_check_runs` across every check × environment, and it backs the highest
call-count read paths: the dashboard badges, the bulk status endpoint, the
per-(system, check, environment) matrix the dependency map and status-page
widgets consume, and the AI system-signals scan. It was only cached for the
single/bulk rollup, was invalidated UNCONDITIONALLY on every check run (so a
steady-state healthy system evicted its own cache every tick), the matrix
endpoint was not cached at all, and the AI signals scan bypassed the cache with
its own uncached N+1.

All four reads now go through a single `HealthCheckCache` facade - built on the
**platform `CacheManager`** - that is the ONE sanctioned reader AND invalidator
of a system's status:

- **Reads** (`read` / `readBulk` / `readMatrix`) are served read-through, keyed
  per `(system, environment)`, holding the RAW (pre-incident-override) status;
  the router folds incident overrides downstream, so an incident change never
  touches this cache. The matrix reuses the same per-environment entries the
  badge path warms. The AI signals contributor now scans candidate systems from
  the durable table and resolves their statuses through `readBulk`, reusing the
  warm cache instead of a fresh N+1.
- **Invalidation is change-gated on the per-check status VECTOR**, not the run:
  `reconcile(previous, next)` evicts only when a check actually flipped status
  (or its slice-failure composition changed) - a `statusFingerprint` invariant
  to the volatile `evaluatedAt` / `lastRunAt` / `runsConsidered`. A run that
  leaves the vector unchanged keeps the cache warm. This also catches a per-check
  flip that leaves the rollup enum unchanged (which the reactive `health` entity
  view would miss). A per-environment run that changes its slice evicts BOTH its
  env key AND the system rollup key (the slice feeds the worst-wins rollup), so a
  simultaneous slice swap - one env recovering as another fails, which the
  rollup's own fingerprint is blind to - still refreshes the rollup. Sibling
  environment keys stay warm.

Cross-pod coherence comes from the SHARED cache backend, not from an application
broadcast: with a distributed provider (Redis) an eviction is a `delete` every
pod sees immediately. On the default in-memory backend the cache is per-pod and
therefore single-instance-only (the Infrastructure Cache UI now warns about
this). The cached value is a derivation of the shared `health_check_runs` tables,
so a miss recomputes the same answer on every pod; the 15s TTL is only a
natural-refresh safety net.

Enforced by design, not convention:

- Every status-mutating writer invalidates through the facade: the run executor,
  the router config/assignment/satellite handlers, the system/satellite lifecycle
  hooks, AND the GitOps apply path (create/update/delete/associate/disassociate),
  which writes configs directly on the service rather than through the router and
  would otherwise have stranded a stale status until the TTL.
- A `checkstack/no-direct-system-status-read` lint rule (error) forbids raw
  `service.getSystemHealthStatus(...)` reads anywhere except the cache facade and
  the executor / entity-compute paths that must read live to detect a transition.
- A `checkstack/no-direct-health-run-insert` lint rule (error) forbids raw
  `insert(healthCheckRuns)` outside the executor / service run writers.

The executor's per-run change-gate reads its pre-run baseline INSIDE the
per-(system, environment) advisory-lock critical section (not before the probe),
so a concurrent same-slice run cannot commit between the baseline read and the
insert and cause the gate to miss a real transition.

Behavior is unchanged for readers (same values, strictly fresher than the prior
15s-stale-on-quiet-systems behavior). The `getSystemHealthStatus` /
`getBulkSystemHealthStatus` / `getBulkSystemHealthMatrix` RPC contracts are
untouched, so cross-plugin callers (dependency, SLO, status-page) need no change.
