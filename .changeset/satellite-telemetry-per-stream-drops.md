---
"@checkstack/ingest-utils": patch
"@checkstack/satellite-common": patch
"@checkstack/satellite": patch
"@checkstack/satellite-backend": patch
"@checkstack/logstream-backend": patch
"@checkstack/metricstream-backend": patch
---

Attribute satellite in-transit telemetry drops PER STREAM instead of a single
connection-level count. Previously a satellite reported one aggregate
`droppedSinceLast` per batch, and each core handler charged that full count to
every stream the batch touched - so a multi-stream batch over-counted the loss
on every stream, and a drop that belonged to one stream was smeared across the
others.

- Wire: `telemetry_batch.droppedSinceLast` (a single number) is replaced by
  `droppedByGroup` - a map of per-group drop counts, keyed by an opaque domain
  group string the capability handler interprets (the stream token for the
  forward paths, the scrape target id for `metric-scrape`). The whole satellite
  telemetry feature is unreleased, so this is a clean replacement, not a
  breaking change to any shipped agent.
- Agent (`@checkstack/satellite`): the telemetry client buckets buffered items
  by a caller-supplied `groupKeyOf`, so drop-oldest eviction is naturally
  per-group; the loss rides the next batch's `droppedByGroup`. A terminal ack's
  `rejected` is no longer folded back into the agent's drop counter - that is a
  core-side outcome the core attributes itself, and folding it double-counted
  the loss and (for a bad token) misattributed it to unrelated streams.
- `@checkstack/ingest-utils`: `IngestBuffer` (drop-oldest mode) now reports
  `droppedByKey` alongside the aggregate `dropped`, so a caller can attribute
  each eviction to the key it belonged to.
- Core handlers (logstream forward, metricstream forward + scrape) resolve each
  `droppedByGroup` key to its stream - reusing the same token-verdict / target
  -binding lookups the payload uses - and record the loss against that stream
  alone. A key that no longer resolves to a stream (unknown/revoked token,
  unbound target) is left unattributed rather than charged elsewhere.
