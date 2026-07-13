---
"@checkstack/metricstream-frontend": minor
---

Add the metric-streams management and viewer UI. A "Metric Streams" surface
under Reliability lists every stream with its last-received time, datapoint
rate, series-cap usage (with a warning tone from 80% and a dropped-series
indicator) and a coaching empty state; creating a stream is gated on the
contract-derived create verdict and picks an owning team.

The stream detail page has four URL-synced tabs:

- Overview: stat tiles (datapoints/min, last received, series used vs cap with
  cap-usage tone, dropped counters), an important-events timeline (series-cap,
  scrape-failing, silence icons and tones) and a searchable metric quick-chart
  (per-bucket average with a dashed max envelope over a date range, null-filled
  across the full bucket axis so gaps stay honest).
- Metrics: a server-side searchable browser over the stream's metric names
  (type, unit, series count, last seen) that expands to a metric's label keys
  and a bounded sample of concrete series.
- Sources: push-endpoint snippets (OTLP + native JSON, `ckms_` token hint),
  mint-once/revoke source tokens, and Prometheus scrape-target CRUD (name, URL,
  interval, optional bearer-token secret with a stored/keep/clear affordance,
  enable toggle, last-scrape status with errors surfaced).
- Settings: caps/retention policy form and a typed-name delete danger zone.

Contributes the `metricstream` health-check strategy/collector config dropdown
resolvers (stream, searchable metric name, and label key/value pickers - the
label-value picker reads its own filter row's key via the DynamicForm
row-scoped form values). List-page queries opt into whole-plugin signal scope;
detail-page queries auto-scope to their stream.
