---
"@checkstack/maintenance-common": minor
"@checkstack/maintenance-backend": minor
"@checkstack/maintenance-frontend": minor
---

Add an `includeCompleted` filter to `listMaintenances`, mirroring the incident
plugin's `includeResolved`. The maintenance config page gains a "Show completed"
toggle, and the system maintenance history page opts in so completed windows
still appear there.

BREAKING CHANGE: `listMaintenances` now hides `completed` maintenances by
default (`includeCompleted` defaults to `false`), matching how `listIncidents`
hides `resolved` incidents. API/SDK consumers that relied on `listMaintenances`
returning completed windows must now pass `includeCompleted: true` (or an
explicit `status: "completed"` filter, which still wins regardless of the flag).
