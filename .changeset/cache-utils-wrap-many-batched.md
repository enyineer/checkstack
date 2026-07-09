---
"@checkstack/cache-utils": minor
---

feat(cache-utils): add `CachedScope.wrapManyBatched` (epoch-guarded batched read-through)

`wrapManyBatched(ids, { keyFor, load })` serves cache hits and loads the MISSES
in ONE batched call (unlike `wrapMany`, which runs a loader per id), returning
values in input order. Crucially it carries the SAME per-key epoch guard as
`wrap`: a value is only written back if its key was not invalidated during the
load, so a concurrent mutation that invalidates a key mid-load truly wins the
race and cannot be clobbered by an in-flight loader's stale write. It also fails
open (a `provider.get` error is treated as a miss). This is the primitive the
auth `role -> access-rule ids` cache uses to keep its batched miss-load without
giving up the staleness guarantee the single-key `wrap` path already had.
