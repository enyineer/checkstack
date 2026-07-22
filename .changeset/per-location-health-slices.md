---
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-frontend": minor
---

Evaluate health per probe location, so a failing satellite can no longer read as healthy

Thanks to @stuajnht for reporting: a system whose local check succeeded and
whose satellite check failed was shown as **healthy**, and the report correctly
guessed the cause - one combined verdict where there should have been one per
location.

A check's runs were grouped into slices by environment alone, so both locations'
runs landed in the same slice and were handed to the threshold evaluator as one
interleaved stream. In the default `consecutive` mode the streak breaks on every
alternation, no threshold is ever reached, and evaluation falls through to its
healthy default. A satellite failing 100% of the time was therefore invisible
for as long as a local check succeeded between its runs.

A slice is now an **(environment, source)** pair - one environment as probed
from one location - and each is evaluated on its own window, with the worst
result deciding the check. This is the same rule environments already followed;
the source dimension was simply never considered. Both the system rollup and the
system overview were affected, and both are fixed.

Related correctness fixes that fall out of keying slices by source:

- A **de-assigned satellite** (or the core after **Include local** is turned
  off) stops counting immediately instead of dragging the rollup with its last
  failures until they age out of the window. Its history moves under **Old
  checks**.
- **Per-satellite environment scoping** is honoured when resolving slices, so a
  satellite narrowed to production no longer keeps a stale staging slice alive.
- A satellite scoped to run env-less while the core fans out keeps its slice
  live; the "has a live environment slice" question is now answered per
  location, as the backend already did.

The system overview shows one row per slice and names the location (for example
**EU West**) as soon as a check runs from more than one place. A check that only
ever runs on the core shows no location label - there is nothing to
disambiguate.

`checkStatuses[].slices` and the overview's per-slice entries carry the
breakdown (`sourceId`, `sourceLabel`, `sourceOrphaned`) on the wire, and
`sliceCount` / `failingSliceCount` now count locations as well as environments -
so a check probing one environment from the core and one satellite contributes
2 to the dashboard's "X of Y checks failing" denominator, not 1.
