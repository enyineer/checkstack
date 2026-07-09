---
"@checkstack/anomaly-common": minor
"@checkstack/anomaly-backend": patch
---

fix(anomaly): clear a suspicious anomaly from the dashboard when it resolves

A `suspicious` anomaly row that never reached its confirmation threshold is
DELETED rather than moved to `recovered`. Both delete paths - the inline spike
detector and the hourly drift evaluator - performed that delete silently: no
`invalidateAnomalies()` on the router-level cache and no `ANOMALY_STATE_CHANGED`
broadcast, unlike every other transition around them. Because the frontend drops
stale dashboard state exclusively via the signal bus (`SignalAutoInvalidator`
invalidates `[[pluginId]]` on any incoming signal), nothing ever told the
dashboard to refetch. The "Suspicious behaviour" badge, the system-detail widget
and the aggregated system signal therefore stayed on screen until an incidental
refetch (remount or window refocus) happened to fire - the suspicion showed up
correctly but never went away when it turned out to be nothing.

Both delete branches now drop the cache and broadcast, so the badge disappears
as soon as the metric returns to normal.

The drift evaluator additionally never invalidated the router cache on ANY of
its writes (create / confirm / self-resolve / recover), so a forced refetch could
still read a stale anomaly list back out of the 15s server-side cache. It now
invalidates on every row write, matching the spike detector. To make this
possible the router cache is constructed before the baseline-analyzer job is
scheduled and threaded into `evaluateDrift`.

BREAKING CHANGE: `ANOMALY_STATE_CHANGED`'s `newState` is now typed by the new
`AnomalyStateChangeSchema` (`suspicious` | `anomaly` | `recovered` | `cleared`)
rather than the persisted `AnomalyStateSchema`. The added `cleared` value marks
"an unconfirmed suspicious row was deleted", which has no persisted state to
report. It is deliberately distinct from `recovered`: a suspicious row never
produced a "confirmed" notification, so clearing it must not look like a
recovery to a subscriber that alerts on one. Consumers that exhaustively switch
on `newState` must handle `cleared`; consumers that only invalidate caches (the
platform default) need no change.
