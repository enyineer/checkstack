---
title: Ship metrics to a stream
description: Send OTLP metrics, configure Prometheus scrape targets, or push JSON datapoints into a Checkstack metric stream.
---

This walkthrough gets metrics flowing into a [metric stream](/checkstack/user-guide/concepts/metric-streams/). Create the stream first (Metric Streams in the sidebar, under Reliability), then pick the source that fits each producer - a stream can use all of them at once.

## Push with a source token

Push sources authenticate with a per-stream source token. Open the stream's **Sources** tab, mint a token, and copy the `ckms_...` secret immediately - it is shown only once. Send it as `Authorization: Bearer <token>`.

### OTLP

Point any OpenTelemetry SDK or Collector at the stream's OTLP endpoint shown on the Sources tab (it accepts the standard protobuf and JSON encodings, gzipped or plain). For an OpenTelemetry Collector:

```yaml
exporters:
  otlphttp/checkstack:
    metrics_endpoint: https://<your-checkstack>/api/metricstream/v1/metrics
    headers:
      Authorization: "Bearer ckms_YOUR_TOKEN"
```

### JSON

For scripts and custom apps, post plain JSON:

```bash
curl -X POST https://<your-checkstack>/api/metricstream/ingest \
  -H "Authorization: Bearer ckms_YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[{"name":"queue_depth","type":"gauge","value":42,"labels":{"queue":"emails"}}]'
```

`type` defaults to `gauge`; counters accept `"type":"counter"` with their cumulative value.

## Pull with scrape targets

For anything that already exposes a Prometheus endpoint, add a **scrape target** on the Sources tab: a name, the exporter URL, the scrape interval, and optionally a bearer token (stored encrypted). Checkstack scrapes it on the interval, parses the exposition format (counters, gauges, histograms and summaries as sum/count), and shows the last scrape result per target - persistent failures raise an important event.

> [!NOTE]
> Scrape URLs are fetched by the Checkstack backend, so an operator who can manage a stream chooses where it connects. Requests to cloud metadata and link-local addresses are always refused; reaching internal exporters on private networks is allowed by design, so grant stream-manage accordingly.

## Scrape or forward metrics through a satellite

When an exporter lives in a network zone the core cannot reach, a
[satellite](/checkstack/user-guide/concepts/satellites/) running in that zone can
either scrape the exporter or receive pushed metrics and forward everything over
its single outbound WebSocket. The zone needs no inbound firewall hole to the
core.

### Scrape a target from a satellite

Add a scrape target on the **Sources** tab as above, then bind it to a satellite
instead of leaving it on the core:

1. In the scrape-target dialog, choose the satellite that can reach the exporter.
   The picker only offers satellites you have read access to that advertise the
   `scrape` capability.
2. Save the target. The core pushes the target config to the satellite, and the
   satellite polls the exporter on the interval and forwards the datapoints.

The core accepts scraped datapoints only for a target actually bound to the
sending satellite, so binding is the authorization. If the target needs a bearer
token, Checkstack delivers it just in time over the secure channel for each
scrape; it is never stored on the satellite and never travels in the pushed
scrape config.

> [!NOTE]
> The satellite applies the same egress guard the core does: requests to cloud
> metadata and link-local addresses are refused, with a scheme guard, a response
> size cap, and a timeout. Reaching internal exporters on the zone's private
> network is allowed by design.

### Forward pushed metrics through a satellite

If a producer inside the zone pushes metrics rather than exposing a scrape
endpoint, enable the satellite's metric receiver and point the producer at it
with a `ckms_` source token. The satellite forwards the token unchanged and the
core verifies it exactly as it does a direct push. An operator enables the
receiver:

```env
CHECKSTACK_SATELLITE_LOG_RECEIVERS=1
CHECKSTACK_SATELLITE_RECEIVER_PORT=4318
```

This exposes `/v1/metrics` (OTLP metrics) and `/ingest/metrics` (native metrics)
on the satellite. Point the producer at those paths on the satellite's host:

```bash
curl -X POST http://satellite.internal:4318/ingest/metrics \
  -H "Authorization: Bearer ckms_YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[{"name":"queue_depth","type":"gauge","value":42,"labels":{"queue":"emails"}}]'
```

See [Connect a satellite](/checkstack/user-guide/guides/connect-a-satellite/#telemetry-forwarding-and-scraping)
for the full set of telemetry flags. Buffered datapoints dropped during a
satellite disconnect surface as **Dropped in transit** on the stream's overview.

## Verify and use

Within a minute of the first datapoints, the stream's **Metrics** tab lists the discovered names, types, and series. From there, create a Metric Stream health check - the metric and label pickers autocomplete from what actually arrived. If nothing shows up, check the token (401s), the per-request limits (413/429), or the target's last scrape error.
