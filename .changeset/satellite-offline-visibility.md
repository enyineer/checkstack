---
"@checkstack/satellite-backend": minor
"@checkstack/satellite-common": minor
"@checkstack/satellite-frontend": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-frontend": minor
---

Per-satellite offline threshold, connectivity notifications, and stop satellite-only checks going silent

**A satellite going offline was invisible, and so were its checks.** Three
related changes:

**Per-satellite offline threshold.** The 45-second global constant is now a
per-satellite override (**Offline after**, 2 minutes to 24 hours), because
tolerance is a property of the link, not of the platform: a satellite on a flaky
uplink needs grace that should not be forced on every other satellite. The
threshold is carried on every row read by `computeStatus`, so the entity read,
the admin list and the heartbeat monitor cannot disagree about the same
satellite. Additive, nullable column - existing satellites keep the default.

**Connectivity notifications.** Satellites are now a notification target with a
**Satellite connectivity** subscription: a warning when a satellite stops
heartbeating, informational when it returns. A reconnect only notifies if the
satellite was actually offline, so a redeploy is not an event. (The same
transitions remain available as `satellite.heartbeat_lost` / `.connected`
automation triggers for anyone wanting different routing.)

**Satellite-only checks no longer go silent.** BUG FIX: a check with
`includeLocal: false` whose satellites were all offline recorded NOTHING, so it
displayed its last known status indefinitely - a dead probe was indistinguishable
from a passing one. The core now records a `degraded` run with a clear message.
Degraded rather than unhealthy because the target may be fine; what failed is our
ability to observe it. Liveness that cannot be resolved is treated as "executing"
so a transient lookup failure cannot mark the whole fleet degraded at once.

Checks also surface staleness: a last run older than five intervals (minimum ten
minutes) is highlighted, so an ageing status is visible even with no run to
explain it. Paused checks are never stale, and neither is a RETIRED slice - one
whose environment was removed or whose satellite was unassigned - because
warning about something you retired on purpose trains operators to ignore the
badge.

The unobservable run does NOT notify subscribers. One offline satellite degrades
every check assigned to it in the same tick, and `healthy -> degraded` is an
escalation, so notifying per check would turn a single root cause into one alert
per check. The satellite's own connectivity subscription reports the cause once;
the runs are still recorded, so health and the UI stay honest.

Satellite liveness is cached on the shared platform cache with a 5s TTL. The
executor asks per tick of every satellite-only check and the read is a full
scan, so the uncached version scaled with the number of such checks. The TTL is
well below the smallest offline threshold the schema allows, so a cached answer
can lag a transition by one tick but never span one.

Corrects the user guide, which claimed offline satellites produced failed runs -
they produced nothing at all.
