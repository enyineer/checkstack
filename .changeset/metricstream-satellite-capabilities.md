---
"@checkstack/metricstream-common": minor
"@checkstack/metricstream-backend": minor
"@checkstack/satellite-backend": minor
---

Add satellite telemetry for metric streams: forward push telemetry through
satellites and scrape Prometheus targets FROM a satellite instead of core.

metricstream-backend now contributes two handlers to satellite-backend's
capability extension point (dependency inversion - the domain plugin
contributes; satellite-backend never imports metricstream):

- **kind `metricstream`**: a satellite receiver forwards push telemetry it
  accepted for one or more streams (payload is an array of `{ streamToken,
  datapoints }` groups). Authorized end to end by each stream's `ckms_` source
  token (verified on core exactly like the HTTP push path); a bad/revoked token
  drops that group non-retryably. Forwarded datapoints go through the SAME
  ingest sink the HTTP push + scrape paths use (no duplicated fold logic).
- **kind `metric-scrape`**: a scrape target can be BOUND to a satellite
  (`metric_scrape_targets.satellite_id`). `buildCapabilityConfig` tells each
  satellite which targets to scrape (`{ targets: [{ id, name, url,
  intervalSeconds, timeoutMs, maxSeries, hasBearer }] }`). Forwarded scrape
  batches (`[{ targetId, datapoints }]`) are authorized by the target BINDING:
  core accepts an entry only when the target belongs to the sending satellite,
  rejecting mismatched/unknown targets. `handleCapabilityStatus`
  (`[{ targetId, lastScrapeAt, lastError, consecutiveFailures? }]`) mirrors
  per-target scrape health and fires the `scrape_failing` event on the threshold
  crossing, reusing the core reconciler's one-event-per-episode semantics.

BEARER SECRETS: the bearer NEVER rides the config push. The config only flags
`hasBearer`; the agent fetches the token just-in-time via a
`capability_secret_request`, which the core handler's `resolveSecret` answers -
binding-authorized (resolved ONLY when the target is bound to the requesting
satellite) and returned over the authenticated channel, never persisted or
logged. This reuses the health-check JIT secret pattern.

The core Prometheus scrape reconciler EXCLUDES satellite-bound targets from its
scheduling (they are scraped on the satellite) and cancels a target's core job
when it rebinds core -> satellite; a rebind back reschedules it. Scrape-target
CRUD notifies BOTH the old and new satellite so each converges its scrape set.

Two new forward-only migrations: `metric_scrape_targets.satellite_id` (+ index),
and `metric_stream_activity.dropped_in_transit_count` - a new counter of
telemetry a SATELLITE dropped from its bounded buffer during a disconnect /
slow-consumer episode (reported per stream via each batch's `droppedByGroup`,
keyed by scrape target id for the scrape path and stream token for the forward
path), surfaced on the `StreamActivity` / overview read model (distinct from
cardinality-cap and buffer-full drops).

metricstream-common gains: an optional `satelliteId` on the scrape-target DTOs
(create/update/read); the shared satellite capability wire schemas
(`MetricScrapeConfigSchema`, `MetricScrapeBatchSchema`, `MetricScrapeStatusSchema`,
`MetricstreamForwardBatchSchema`, `WireDatapoint` + `wireDatapointToNormalized`)
so the agent and frontend validate the same payloads; and the pure
`parseOtlpMetricsJson` (moved from metricstream-backend so the satellite agent's
`/v1/metrics` receiver can import it - backend now re-exports it).

`@checkstack/satellite-backend` (minor, additive): the `handleTelemetryBatch`
capability-handler ctx now carries the envelope's optional per-group
`droppedByGroup`, and the WS handler forwards it, so a domain handler can
attribute in-transit drops to the exact stream that lost data.

SECURITY: authorize the caller-supplied `satelliteId` when creating/updating a
scrape target. Previously the only gate was the stream `manage` grant, so a
team-scoped stream manager could bind their target to another team's satellite +
an internal URL in that satellite's zone, turning core into a cross-zone SSRF
pivot. Binding a non-null satellite now requires (over a caller-scoped RPC) that
the satellite EXISTS, the CALLER can READ it (`satellite.read`, else FORBIDDEN),
and it advertises the `scrape` capability (else BAD_REQUEST) - applied on both
create and update (rebind). A null binding (scrape from core) is unaffected.
