---
"@checkstack/frontend": patch
---

Coalesce realtime signal cache invalidations so signal-heavy pages stop
storming the backend with redundant refetches. During active health checking
the catalog previously issued one `getBulkSystemHealthStatus` refetch per
incoming `healthcheck` signal — with rapid successive invalidations cancelling
the in-flight request (503s) and immediately refetching again.

`SignalAutoInvalidator` now routes both invalidation passes (the owning plugin
and any `foreignSignals` subscribers) through a per-target trailing-debounce
coalescer (300ms window), so a burst of signals for the same plugin triggers a
single `invalidateQueries`. Because `invalidateQueries` is idempotent, the
single trailing refetch returns the latest server state — this is purely a
reduction of redundant, mutually-cancelling in-flight fetches, with no change to
query behavior, `staleTime`, or `enabled`. An isolated lone signal still
refreshes within the window (well under human-perceptible latency). The
coalescing logic is extracted into a unit-tested `createInvalidationCoalescer`
module.
