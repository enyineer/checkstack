---
"@checkstack/tracestream-common": minor
"@checkstack/tracestream-backend": minor
"@checkstack/tracestream-frontend": minor
"@checkstack/satellite": minor
---

Tracestream health checks and satellite forwarding:

- New reader-only OBSERVABILITY health strategy (`tracestream`) with two
  collectors: `trace-window` (windowed span/trace totals, error counts,
  error rate per minute, seconds since last span) and the repeatable
  `operation-latency` (per service/operation `p95Ms`/`avgMs`/`maxMs` and
  error rate; the window p95 merges the minute buckets' t-digest states
  before computing the percentile). The check editor gets
  stream/service/operation dropdowns via shared resolver constants.
- Fast-path re-evaluation: a flush that persists error spans enqueues the
  affected checks ahead of schedule (pod-local debounce + deterministic
  cluster-wide job id), and a new `error_spike` important event records
  trailing-average error spikes at most once per stream per 10 minutes.
- Satellite trace forwarding: satellites with
  `CHECKSTACK_SATELLITE_TRACE_RECEIVERS=1` expose local `/v1/traces`
  (OTLP protobuf + JSON) and `/ingest/traces` (native) receivers; spans
  ride the new `tracestream` telemetry-channel wire schema (ISO dates,
  decimal-string nanosecond timestamps) and re-enter the core through a
  satellite capability handler that verifies the forwarded `cktr_` token
  with the same authenticator as direct pushes and re-clamps span times
  against the core clock before feeding the identical ingest pipeline.
