---
"@checkstack/healthcheck-backend": minor
---

perf(healthcheck): stop recomputing the full system rollup on every check run

The queue run executor captured the system-wide rollup health
(`getSystemHealthStatus(systemId)`) at the start of EVERY check tick - a
worst-wins aggregate that fans out an N+1 of windowed `health_check_runs` reads
across every check × environment of the system. That value was only ever
consumed on the rare catastrophic-failure path (a job that throws before running
any probe); the normal success/failure paths record their transition from the
per-environment pre-read and never touched it. Under load this was one of the
heaviest repeated reads on the hot path.

The rollup pre-status is now computed lazily, only inside the catastrophic-
failure branch that actually uses it. Behavior is unchanged - the catastrophic
path reads the same pre-tick rollup (it is reached only when the run threw before
inserting anything, so nothing changed in between) - but every normal check tick
no longer pays for a full rollup recompute it discards.
