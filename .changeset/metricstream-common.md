---
"@checkstack/metricstream-common": minor
---

New package: contracts and shared types for Metric Streams. Carries the stream /
token / scrape-target / autocomplete / bucket-read RPC contract with per-proc
instance-access modes, the metric stream config schema (series-cardinality cap,
retention tiers, ingest budgets), normalized datapoint and series DTOs, the
`ckms_` source-token format helpers (browser-safe), resource-scoped activity and
important-event signals, and the health-editor resolver name constants.
