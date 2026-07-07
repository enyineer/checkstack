---
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-frontend": minor
---

Show the last successful run per check (or per check+environment when fanned
out) in the system overview.

Each overview row that is currently degraded or unhealthy now shows when it was
last healthy (for example "Healthy until 2h ago", or "Never healthy" when it has
never succeeded), so operators can see at a glance since when a system has been
degraded or unhealthy without opening the drawer.

`getSystemHealthOverview` gains a `lastSuccessfulRunAt` field at both the check
level (most recent healthy run across all of the check's environments) and per
environment (`perEnvironment[].lastSuccessfulRunAt`). It is computed with a
dedicated max-per-environment aggregate query OUTSIDE the bounded sparkline
window, so it stays accurate even when a check has been failing for far longer
than the last runs shown in the sparkline.
