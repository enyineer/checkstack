---
"@checkstack/slo-common": minor
"@checkstack/slo-backend": minor
"@checkstack/slo-frontend": minor
"@checkstack/maintenance-common": minor
"@checkstack/maintenance-backend": minor
---

Exclude planned maintenance windows from the SLO error budget.

SLO objectives gained an opt-in `excludeMaintenanceWindows` flag (defaults to
false, so existing SLO numbers are preserved). When enabled, the portion of any
downtime that overlaps a non-cancelled maintenance window on the system is
subtracted from consumed budget, using pure, unit-tested interval math.

Because an error budget is a TRAILING window (for example the last 30 days),
maintenance is pulled by TIME-RANGE OVERLAP over that window via a new
`maintenance.getMaintenanceWindowsForRange` read query, which includes
already-completed windows and excludes only `cancelled` ones. This means "last
night's planned maintenance" keeps being subtracted after it completes, and the
consumed number does not jump as a window transitions
`scheduled -> in_progress -> completed`. The windows are injected into the SLO
engine like the existing health-status callback. The SLO editor now has a toggle
bound to the field, so the "exclude maintenance" help copy is finally accurate.

Note: historical `slo_daily_snapshots` are not rewritten, so a trend chart may
briefly differ from the live number after toggling this on.

Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.
