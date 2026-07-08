---
"@checkstack/healthcheck-backend": patch
"@checkstack/healthcheck-common": patch
"@checkstack/healthcheck-frontend": patch
---

fix(healthcheck): disabling an environment for an assignment now clears its stale slice from the rollup and overview immediately

Disabling an environment for a health-check assignment (removing it from the
assignment's `environmentIds`) stopped that environment from fanning out, but a
check that was FAILING there kept dragging the system health rollup/badge to
unhealthy and kept showing as a live failing row in the system overview. Because
the rollup is recomputed by an event-driven consumer subscribed to per-env health
CHANGES, and a disabled env produces no further runs (so no change event fires),
the stale unhealthy status was never recomputed away - it only cleared
incidentally, once the disabled env's runs aged out of the bounded run window
(which needs the assignment's OTHER active environments to produce enough newer
runs first). With a single active/failing env, it could persist until retention.

Scope: this reconciles environments DISABLED/removed ON THE ASSIGNMENT (its
`systemHealthChecks.environmentIds` selector - switching to Specific and
deselecting, or None).

Fixes:
- The rollup aggregation (`getSystemHealthStatus`) and the per-check status in
  `getSystemHealthOverview` now consider only CURRENTLY-EFFECTIVE environment
  slices, derived from the durable `systemHealthChecks.environmentIds` selector
  (catalog-free, identical on every pod). A slice whose environment was disabled
  for the assignment, or the stale env-less slice of a check that now fans out,
  no longer contributes.

Known limitation: under an "all-environments" assignment (`environmentIds` is
`null`), an environment removed only from the system's CATALOG MEMBERSHIP (rather
than disabled on the assignment) can still contribute to the backend rollup/badge
until the assignment is re-evaluated, because the rollup read path is
intentionally catalog-free for horizontal-scale correctness (it must return the
same answer on every pod without a per-read catalog lookup). This is pre-existing;
the frontend overview, which can see membership, still orphans such a slice.
- Each environment is now windowed by its OWN query in the rollup, instead of a
  single shared `LIMIT` across the mixed-env pool. The old shared window
  truncated per-env evaluation for checks that fan out to many environments (or
  with large threshold windows); every environment now gets its full evaluation
  depth.
- Changing an assignment's environment set now triggers an immediate rollup
  recompute for that system, so the persisted `health` entity (badge + SLO
  downtime) converges at once rather than waiting for stale runs to age out.
- The system-overview frontend tucks a slice whose environment was disabled for
  the assignment under "Old checks" (system membership alone could not detect it,
  since the environment is still part of the system). `getSystemHealthOverview`
  now returns each check's `environmentIds` selector to drive this.

Shared pure helpers `selectorIncludesEnvironment` / `isEnvSliceEffective` /
`selectEffectiveEnvKeys` are added to `@checkstack/healthcheck-common` so the
backend and frontend agree on effective-slice detection.
