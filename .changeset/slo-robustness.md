---
"@checkstack/slo-backend": minor
---

Make SLO downtime robust against a drifted event log (fixes "100% available yet degraded" and "ongoing downtime while every check is healthy").

SLO downtime was stored as edge-triggered open/close interval rows, so a single missed/out-of-order transition left an event open forever and read as ongoing downtime even when healthy. The fix makes live health authoritative:

- `computeStatus` is now live-health-authoritative and side-effect-free: a stored open event counts toward availability/error-budget and sets `hasOpenDowntime` only when the system is actually down right now (verified via the health callback, checked only when open events exist). A healthy system can no longer read breaching/degraded from a stale row, and this stays pure so the reactive `slo` entity can keep reading through it.
- Window accounting is fixed: `getDowntimeForWindow` counts the in-window portion of every overlapping interval (clamped to the window; open events run to "now" only when included), via a pure `downtime-window` helper, so an outage that began before the window is no longer dropped.
- Missed-recovery orphans are voided: the daily job deletes open events on currently-healthy systems (their true recovery time was never recorded). The edge-triggered close still records real downtime on normal recoveries.

Regression tests cover the window-overlap math, the live-health authority, the no-open-event fast path, and orphan voiding.

This is a beta minor.
