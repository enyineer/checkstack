---
"@checkstack/logstream-common": patch
"@checkstack/logstream-backend": patch
"@checkstack/logstream-frontend": patch
---

Surface satellite in-transit log drops on the log stream overview, mirroring
metricstream. When a satellite forwards logs and its bounded in-memory buffer
drops lines during a disconnect / slow-consumer episode, the agent reports the
per-stream counts as `droppedByGroup` on the telemetry batch (keyed by stream
token). The logstream satellite handler previously ignored it, so operators got
no signal that forwarded logs were lost.

- `log_stream_activity` gains a `dropped_in_transit_count` column (additive
  forward-only migration; safe on populated tables).
- The satellite telemetry handler resolves each `droppedByGroup` token to its
  stream and records the loss against THAT stream via a best-effort
  `addInTransitDrops` upsert (atomic, cross-pod safe; a bookkeeping write never
  fails an accepted batch). A token that no longer resolves to a stream is left
  unattributed rather than charged to another stream.
- The stream overview read model exposes `droppedInTransitCount`, and the
  overview tab renders a "Dropped in transit" tile (warn tone when > 0).
