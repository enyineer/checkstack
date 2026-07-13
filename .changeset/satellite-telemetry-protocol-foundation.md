---
"@checkstack/satellite-common": minor
"@checkstack/satellite-backend": minor
"@checkstack/satellite": minor
"@checkstack/ingest-utils": minor
---

Add the satellite telemetry protocol + capability foundation (log/metric
forwarding and satellite-side scraping build on this). All additions are
additive and version-skew safe - every new field is optional and old peers
ignore unknown message types and fields, so mixed-version fleets keep working.
The existing health-result path is untouched.

- `@checkstack/satellite-common`: new generic telemetry envelopes on the WS
  protocol - `telemetry_batch` / `capability_status` (satellite -> core) and
  `telemetry_ack` / `capability_config` (core -> satellite). `authenticate` and
  `heartbeat` gain an optional `capabilities` list. New flow-control constants
  (max in-flight, batch item/byte caps, per-connection dedupe window and
  bytes/min budget, ack timeout, pump interval).
- `@checkstack/satellite-backend`: a `satellite.capability` extension point so
  domain plugins contribute a handler per `kind` (ingest a batch, build the
  pushed config, handle a status update) without satellite-backend depending on
  any domain plugin. The WS handler routes telemetry by kind, dedupes resent
  batchIds per connection, enforces a per-connection byte budget (over-budget =
  retryable ack, never a disconnect), acks every batch, and pushes
  `capability_config` on connect and on `notifyCapabilityConfigChanged`
  (cross-pod via a broadcast domain event). Advertised capabilities are
  persisted on a new `satellites.capabilities` column and surfaced on the read
  model.
- `@checkstack/satellite` (agent): a `TelemetryClient` that buffers per-kind
  (bounded, drop-oldest, counted) and forwards over a credit window (at most N
  unacked batches, chunked to the item/byte caps, monotonic per-connection
  batchId, resend-until-ack, drop-and-count on a terminal ack). Capabilities are
  advertised from env flags; an agent capability registry routes pushed
  `capability_config` to a consumer and sources `capability_status` back.
- `@checkstack/ingest-utils`: `IngestBuffer` gains an opt-in `dropOldest` mode
  (evict oldest to admit new items, report how many were dropped) and a
  `drainChunk` for bounded FIFO draining. The default reject-new behavior the
  backend ingest endpoints rely on is unchanged.

BREAKING CHANGE: none. The platform is in beta; this is purely additive.
