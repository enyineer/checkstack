---
"@checkstack/metricstream-backend": minor
"@checkstack/metricstream-common": minor
---

Harden and correct the Metric Streams backend from the review sweep.

- SSRF egress guard on Prometheus scrapes: before every scrape the target host
  is resolved and validated through the platform egress guard
  (`resolveAndValidateHost` with the default cloud-metadata/link-local denylist,
  the same foundation guard the HTTP healthcheck collector uses), and a denied
  destination fails the scrape as a transport error. Scrape-target URLs are now
  restricted to the `http`/`https` schemes in the create/update contract and
  re-checked at scrape time. RFC1918 targets stay reachable by default (scraping
  an internal Prometheus is legitimate); operators harden further by extending
  the denylist. Mirrors the healthcheck DNS-rebind caveat (pre-flight validation,
  original-URL fetch).
- Cross-tier health reads: the `metric-window` collector now reads BOTH storage
  tiers for a window wider than the stream's `minuteRetentionHours` - the recent
  part from the minute tier and the older part from the hourly tier, folded
  together - instead of silently truncating to the minute tier and dividing the
  counter rate/increase by the full window. Cumulative-counter points are
  stitched contiguously across the rollup boundary so reset-aware differencing
  stays correct, and a series present in both tiers is counted once.
- Series-count drift fix: a flush now advances a metric name's `seriesCount` by
  the series it ACTUALLY inserted (the `ON CONFLICT DO NOTHING ... RETURNING`
  set), so a cross-pod duplicate insert can no longer permanently over-count a
  name and block its retention cleanup. Duplicate-series datapoints still fold
  into their buckets.
- Documented the cardinality cap as best-effort per-pod-flush (bounded,
  self-correcting cross-pod overshoot; no advisory lock) in the config schema and
  the partitioning helper.
