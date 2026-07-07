---
"@checkstack/healthcheck-backend": patch
---

Stop sending a duplicate notification when a fanned-out system goes unhealthy.

A health check that fans out across environments notified once per environment
("... is unhealthy in environment X") AND once more for the system rollup
("... is unhealthy") in the same tick, so operators received two notifications
describing the same outage. The rollup transition is always driven by the very
environment(s) that already notified, so the rollup notification is now
suppressed whenever any environment notified this tick. It is still sent as a
fallback when no environment notified (e.g. every per-env delivery was
suppressed by policy/maintenance or threw), so a real status change is never
left entirely unannounced, and a system with no environments is unaffected.

Only the redundant user-facing notification is dropped: the rollup state
transition is still recorded and the `SYSTEM_STATUS_CHANGED` signal is still
broadcast, so SLO downtime, the dependency graph, the frontend, and automations
(which subscribe to the per-env and rollup entity changes) are unchanged.
