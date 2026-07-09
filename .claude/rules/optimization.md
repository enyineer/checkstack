# Optimizing a query-heavy read path

When you optimize a read path - especially one that shows up as broad database
slowness or a high-call-count / N+1 query - work through this order BEFORE
writing any caching code, and prefer the platform's shared caching mechanism
over a bespoke pod-local cache.

## The order of attack

1. **Fix the query first.** Add or correct **indexes**, collapse an N+1 into a
   single set-based query (`inArray`, a join, a batched load), and remove
   redundant round-trips. A missing index or an N+1 is a bug to fix, not a
   reason to cache. Often this alone removes the pressure.

2. **Only then cache - on the SHARED platform cache.** If the data is read far
   more often than it changes and the query is still hot after step 1, cache it
   through Checkstack's distributed platform cache (`CacheManager` /
   `createScopedCache` / `createCachedScope`), NOT a hand-rolled `Map` or
   module-singleton TTL cache. See
   [`cache-system`](../../docs/src/content/docs/developer-guide/backend/cache-system.md).

## Do NOT invent a pod-local cache

A per-pod, in-process cache (a `Map`, a module singleton, a bespoke
`createKeyedTtlCache`) is almost never the right tool on this platform, which
runs as **N horizontally-scaled pods sharing one database** (see
[`state-and-scale`](./state-and-scale.md)). A value cached in one pod's memory
is invisible to the others, so a write on pod A leaves pod B serving stale data
until a TTL expires - for authorization or health-status reads that is a real
correctness bug, not just staleness.

The shared cache avoids this by construction: with a distributed backend (Redis)
an invalidation is a `delete` on the shared store that every pod sees at once, so
there is ONE coherence mechanism and no cross-pod broadcast to get wrong. And it
is still far cheaper than the query it replaces: a cache `GET` is sub-millisecond,
non-blocking, and does not consume a database connection.

A pod-local cache is justified ONLY for genuinely pod-local infrastructure that
is never a queryable source of truth (e.g. a live WebSocket registry routing to a
connection this pod physically holds). Mark such state
`declareNonReactiveState(...)` and say why. If you find yourself reaching for a
pod-local cache to speed up a shared-DB read, stop - that is the mistake this
rule exists to prevent. Reuse the shared cache instead.

## Checklist before adding any cache

- Did I add/verify the indexes and de-N+1 the query first?
- Is this data read far more than it is written?
- Am I using `CacheManager` / `createScopedCache` / `createCachedScope`, not a
  bespoke pod-local structure?
- Does every mutation of the underlying data invalidate the cache key(s), so a
  read returns the same answer on every pod (state-and-scale question 2)?
- For a horizontally-scaled deployment, does correctness rely on a **distributed**
  backend being selected (memory is per-pod / single-instance only)?
