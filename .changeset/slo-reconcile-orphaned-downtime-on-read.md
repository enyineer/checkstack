---
"@checkstack/slo-backend": minor
---

Fix SLO downtime windows lingering as "ongoing" after a check recovered.

Closing a downtime window depended entirely on catching the system's transient
health-recovery edge (`onEntityChanged`). But that edge is only emitted by a
check RUN: fixing, pausing, deleting, or unassigning the offending check just
invalidates the read cache and emits no edge, and even a plain edit can lose the
single recovery delivery. The open window was then orphaned until the once-daily
reconcile - so the SLO read 100% availability (live health is authoritative for
the budget) while "Recent Downtime Events" still showed an ongoing window 25+
days old. The two views disagreed.

The user-facing SLO reads now reconcile against live health before reporting:
`getDowntimeEvents` and the status reads reconcile an orphaned open window when
the system is currently healthy, so the dashboard self-heals the moment it is
viewed instead of waiting for midnight. The reactive entity `read` /
`computeStatus` stays side-effect-free; the reconcile is a cheap no-op when there
are no open events.

Crucially, reconciling now PRESERVES the genuine downtime instead of erasing it.
The orphaned window is CLOSED at the system's actual recovery time - the first
healthy run on/after it opened, resolved from the healthcheck run history
(`getHistory`) - so a real multi-day outage is counted against the error budget
and availability instead of reading a false 100%. The window is only DELETED as
a fallback when the recovery time can't be determined (e.g. run history pruned),
where the unprovable downtime must not be counted. Note: daily availability
snapshots already written for the affected days are NOT retroactively corrected
(the current/forward numbers are; the historical trend chart keeps its recorded
points).
