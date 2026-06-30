---
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-frontend": minor
---

Paused health-check configurations no longer contribute to their systems'
health aggregate, pausing one now closes any open SLO downtime event it was
keeping open, and the system overview's "Health Checks" list renders a
"Paused" pill for paused checks instead of their stale run-evaluated status.

Previously, pausing a configuration only skipped execution — its stale
failing runs inside the evaluation window kept the system's rollup status
`degraded`/`unhealthy`, which in turn kept any open SLO downtime event open
until those runs aged out, and the system overview list still showed the
paused check as "Unhealthy". Now:

- `getSystemHealthStatus` excludes paused configurations from the worst-
  wins aggregate, so a system whose only failing check is paused reads
  healthy (and paused checks no longer drive the system's red badge).
- The `pauseConfiguration` RPC recomputes the rollup `health` entity for
  every system the config is enabled-assigned to. If the recomputed
  aggregate transitions degraded → healthy, the existing `HEALTH_ENTITY_KIND`
  "recovered" edge fires and the SLO engine closes the open downtime event
  at the pause time. If the system stays degraded (other failing checks),
  the event correctly stays open.
- `resumeConfiguration` intentionally does NOT recompute. The next actual
  run drives any degraded transition: if the check still fails, a fresh
  downtime event opens (the previous one was closed on pause, so the
  `handleSystemDown` idempotent guard doesn't suppress it); if it now
  passes, no event opens. This avoids fabricating a downtime from stale
  last-known state when the underlying condition may have been fixed
  during the pause.
- `getSystemHealthOverview` now returns a `paused` boolean per check. The
  system overview's "Health Checks" list renders a "Paused" pill (unknown
  tone) for paused checks instead of the run-evaluated status, while still
  showing the pre-pause sparkline for context. Paused checks only appear
  under the "All" filter tab, not "Failing" or "Healthy".