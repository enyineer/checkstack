---
"@checkstack/logstream-common": patch
"@checkstack/logstream-backend": patch
"@checkstack/metricstream-common": patch
"@checkstack/metricstream-backend": patch
---

Fix important-events pagination losing same-millisecond events at page
boundaries. The timeline paged on `ts` alone (`before`/`nextBefore`), so when a
page boundary fell inside a cluster of events sharing a millisecond (cap / rate
/ throttle / pattern events fire in bursts at the same `ts`), rows were skipped
or served twice. Both plugins now use a tuple keyset cursor `{ ts, id }` with
`(ts DESC, id DESC)` ordering and a strict tuple comparison, matching
tracestream.

BREAKING CHANGE: the `listImportantEvents` contract shape changes -
`before` -> `cursor: { ts, id }` on input and `nextBefore` -> `nextCursor:
{ ts, id }` on output (no back-compat alias). Timeline UIs that only read the
first page are unaffected; any paginating caller must pass and read the new
cursor.
