---
"@checkstack/logstream-frontend": patch
---

Bound the log explorer's event search by the effective time range at all
times. Previously the default "Last 24h" window was only applied to the
pattern-occurrences chart while `searchEvents` was sent without `from`/`to`
unless the user explicitly picked a range - so filtering to a pattern fetched
its ENTIRE history, and the list could show days-old lines directly under a
chart honestly reporting "no occurrences in this range". The search (and
"Load older" pagination) now shares the exact window the chart uses - the
explicit pick when set, otherwise the minute-quantized last-24h fallback - so
the list and chart always agree and no query is ever unbounded. Pagination
state deliberately keys on the user's explicit facets only, so the rolling
fallback window doesn't reset loaded pages every minute.

(Metric streams were audited for the same issue: all metricstream queries
already require a time window or are limit-capped, so no change was needed
there.)
