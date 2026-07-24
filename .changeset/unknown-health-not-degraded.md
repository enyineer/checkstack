---
"@checkstack/healthcheck-common": patch
"@checkstack/healthcheck-frontend": patch
---

Stop a system with no health data from reading as "Degraded"

A system with no health checks (or whose checks have not run yet) has health
status `unknown`, but two display paths treated every non-`healthy` status as a
problem and fell through to the amber "Degraded" label - so a check-less system
falsely showed "Degraded" on its detail page, in catalog rows, and as a problem
card on the dashboard, with no incident, no failing check, and no failing
dependency to explain it.

Both now omit `unknown` alongside `healthy` (only `degraded` / `unhealthy`
produce a badge or signal), matching the "an unmeasured system is no signal, not
a fault" model the catalog rollup already uses:

- `deriveHealthcheckSignals` (`@checkstack/healthcheck-common`) no longer emits a
  dashboard signal for an `unknown` system. Its doc already said healthy and
  unknown are omitted; the code only skipped healthy.
- The system health badge (`@checkstack/healthcheck-frontend`) returns no badge
  for `unknown`. The decision was extracted into a pure `resolveHealthBadge`
  helper with unit tests.

The dependency "Degrading impact" chips on the edge are unrelated - they show the
edge's configured impact type, and the dependency warning engine already maps an
unmeasured upstream to operational, so it raises no warning.
