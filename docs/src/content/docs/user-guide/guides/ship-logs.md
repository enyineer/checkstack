---
title: Ship logs to a stream
description: Create a log stream, add a push source for its token, and forward logs from the OpenTelemetry Collector, Fluent Bit, Vector, curl, or rsyslog.
---

This guide takes you from nothing to logs flowing into a Checkstack log stream. You create a stream, add a push source to mint its token, point a shipper at one of the ingest endpoints, and confirm the lines arrive. For what a stream does with those lines and how to monitor them, see [Log streams](/checkstack/user-guide/concepts/log-streams/).

## 1. Create a stream

Sign in as a user who can manage log streams (the `logstream.stream.manage` access rule, held by team owners of the stream and by global stream managers). Open **Reliability > Log Streams** in the sidebar and create a stream. Give it a name; you can leave the sampling and retention settings on their defaults and change them later.

## 2. Add a push source

Open the stream, go to its **Sources** tab, click **Add source**, and pick **Push (OTLP / native)**. Give the source a name and create it. On success the source token is shown **once** and starts with `ckls_`. Copy it now and store it wherever your shipper reads secrets; Checkstack keeps only a hash and cannot show it again. The same panel shows ready-to-paste shipper snippets with the token already filled in.

If you lose the token, rotate it from the source's **rotate** action (the key icon on the source row) and update your shipper with the new value. To revoke access entirely, disable or delete the source.

> [!CAUTION]
> A source token grants ingest access to this one stream. Treat it like a password: never commit it, and rotate it if it leaks. Rotation and revocation take effect within about a minute.

The endpoints and headers below use `ckls_...` as a placeholder. Substitute your real token.

## 3. Pick an endpoint

Checkstack accepts logs on three surfaces. All HTTP endpoints authenticate with the token in an `Authorization: Bearer` header (the `X-Checkstack-Token` header also works), accept optional `Content-Encoding: gzip`, and replace `checkstack.example.com` below with your instance's origin.

| Surface | Path | Formats |
|---------|------|---------|
| OTLP/HTTP logs | `/api/logstream/v1/logs` | OTLP `application/json` and `application/x-protobuf` |
| Native | `/api/logstream/ingest` | `application/x-ndjson` and `application/json` |
| Syslog | TCP (optionally TLS) | RFC 5424 |

The native endpoint recognizes `ts` (ISO-8601 or epoch millis; defaults to now), `level` or `severity` (a level name or an OpenTelemetry severity number), and `message` or `body`. Any other fields become attributes; `traceId`, `spanId`, and `resource` are lifted out.

## 4. Configure a shipper

Pick the shipper you run. Each config is complete apart from your token, endpoint host, and (for syslog) port.

### OpenTelemetry Collector

Add an `otlphttp` exporter pointed at the OTLP logs endpoint and wire it into your logs pipeline.

```yaml
exporters:
  otlphttp/checkstack:
    logs_endpoint: https://checkstack.example.com/api/logstream/v1/logs
    headers:
      Authorization: "Bearer ckls_..."

service:
  pipelines:
    logs:
      exporters: [otlphttp/checkstack]
```

### Fluent Bit

Use the `opentelemetry` output plugin to send OTLP/HTTP.

```ini
[OUTPUT]
    Name             opentelemetry
    Match            *
    Host             checkstack.example.com
    Port             443
    Logs_uri         /api/logstream/v1/logs
    Tls              On
    Header           Authorization Bearer ckls_...
```

### Vector

Use an `http` sink that posts NDJSON to the native endpoint.

```toml
[sinks.checkstack]
type = "http"
inputs = ["my_logs"]
uri = "https://checkstack.example.com/api/logstream/ingest"
encoding.codec = "ndjson"
request.headers.Authorization = "Bearer ckls_..."
```

### curl (NDJSON)

Post newline-delimited JSON directly. This is the quickest way to prove a token works.

```bash
curl -X POST "https://checkstack.example.com/api/logstream/ingest" \
  -H "Authorization: Bearer ckls_..." \
  -H "Content-Type: application/x-ndjson" \
  --data-binary $'{"level":"error","message":"payment failed","service":"checkout"}\n{"level":"info","message":"checkout ok","service":"checkout"}'
```

A successful request returns `202` with a JSON body of `accepted` and `rejected` counts.

### rsyslog (RFC 5424)

Syslog ingestion is a **source** bound to one stream, not a token-authenticated HTTP endpoint (see [Add a syslog source](#add-a-syslog-source)). Once an operator has added a syslog source and bound it to this stream, point rsyslog at that source's host and port - every line received on the port lands in the bound stream, no per-message token:

```text
# /etc/rsyslog.d/checkstack.conf
action(type="omfwd"
  target="checkstack.example.com" port="6514" protocol="tcp"
  template="RSYSLOG_SyslogProtocol23Format")
```

`RSYSLOG_SyslogProtocol23Format` emits RFC 5424, which the source frames by octet-counting or newline delimiting, so most syslog daemons work without extra configuration.

> [!NOTE]
> Shipping syslog to a **satellite** receiver is different: the satellite routes by an in-message source token, so include the token in an RFC 5424 structured-data element (`[checkstack@50501 token="ckls_..."]`) or as a `@ckls_...@ ` message prefix. Only the core syslog source drops the token - the binding is its authorization. See [Forward logs through a satellite](#forward-logs-through-a-satellite).

## 5. Confirm ingestion

Back in the stream's **Overview** tab you should see the last-received time update and severity counts start climbing within a few seconds. Use the **Explore** tab to search the raw lines, and **Patterns** to see the templates Checkstack learned. Remember that `info` and `debug` lines are sampled in the raw explorer while the aggregate counts on Overview are complete.

## Limits and backpressure

The endpoints protect the platform, so a well-behaved shipper should handle these responses:

- **`429 Too Many Requests`**: the per-pod ingest buffer is saturated or the stream's soft rate limit (60,000 lines per minute by default) was exceeded. Respect the `Retry-After` header and back off; most shippers do this automatically.
- **`413 Payload Too Large`**: a request body exceeded 10 MB compressed (or 50 MB after gzip decompression). Send smaller batches.
- **`401 Unauthorized`**: the token is missing, malformed, or revoked.
- **`400 Bad Request`**: the body could not be parsed. The OTLP endpoint accepts partial batches and reports rejected records in its `partialSuccess` response rather than failing the whole request.

Individual lines longer than the stream's max line size (32 KB by default) are truncated, and oversized attribute blobs are capped. Neither is an error; the line is still stored.

## Add a syslog source

Syslog ingestion is a configurable **source** bound to a stream, not an environment setting. On the stream's **Sources** tab, add a **Syslog** source and set:

- **Port** - the TCP port the listener binds (for example `6514`).
- **Host** - the bind address (defaults to `0.0.0.0`).
- **TLS** (optional) - filesystem paths to a certificate and private key mounted into the Checkstack container. When both are set the listener serves syslog over TLS. Paths, not inline PEM, so infrastructure can mount the material as a volume.
- **Max connections** - a ceiling on concurrent inbound connections.

The source binds to this one stream, so every RFC 5424 line received on the port is stored in it - there is no per-message token. On Kubernetes (per-pod network namespaces) every Checkstack pod binds the port and a Service or load balancer distributes connections across them, just like the HTTP endpoints. On a shared host network only one pod can hold the port; the others record `EADDRINUSE` as the source's last error, which is expected.

> [!NOTE]
> A syslog source owns a whole port and routes everything on it to one stream. To split syslog traffic across streams, add one source per stream on a distinct port.

## Forward logs through a satellite

If your logs originate inside a network zone that cannot reach the core directly
(a customer VPC, a segmented environment), run a [satellite](/checkstack/user-guide/concepts/satellites/)
in that zone and let it forward the logs over its outbound WebSocket. Shippers
then target the satellite instead of the core, so the zone needs no inbound
firewall hole to Checkstack.

The satellite is a relay, not a new trust boundary: it forwards the same `ckls_`
source token your shipper would otherwise send to the core, and the core verifies
it identically (rotation included). Add the push source exactly as in step 2 above.

### 1. Enable the receiver on the satellite

An operator starts the satellite with the log receiver enabled. The receiver
exposes the same OTLP and native surfaces the core does, on the satellite's own
host and port:

```env
CHECKSTACK_SATELLITE_LOG_RECEIVERS=1
CHECKSTACK_SATELLITE_RECEIVER_PORT=4318
CHECKSTACK_SATELLITE_RECEIVER_HOST=0.0.0.0
```

This exposes `/v1/logs` (OTLP logs) and `/ingest` (native NDJSON logs) on the
satellite. To accept RFC 5424 syslog inside the zone as well, also enable the
satellite's syslog receiver:

```env
CHECKSTACK_SATELLITE_SYSLOG=1
CHECKSTACK_SATELLITE_SYSLOG_PORT=6514
```

Unlike the core syslog source (which routes by binding), the satellite syslog
receiver stays token-routed: it forwards each line to the core under the `ckls_`
source token carried in the message, so shippers must include the token in an
RFC 5424 structured-data element (`[checkstack@50501 token="ckls_..."]`) or a
`@ckls_...@ ` message prefix. The satellite groups lines by token and forwards
each group to the stream that token belongs to.

See [Connect a satellite](/checkstack/user-guide/guides/connect-a-satellite/#telemetry-forwarding-and-scraping)
for the full set of telemetry flags. Enabling any receiver implies the telemetry
channel, so the satellite advertises the `telemetry`, `log-receivers`, and (if
enabled) `syslog` capabilities.

### 2. Point the shipper at the satellite

Use any of the shipper configs above, but replace the core origin with the
satellite's host and receiver port. The token and paths are unchanged. For
example, with curl against the native endpoint:

```bash
curl -X POST "http://satellite.internal:4318/ingest" \
  -H "Authorization: Bearer ckls_..." \
  -H "Content-Type: application/x-ndjson" \
  --data-binary $'{"level":"error","message":"payment failed","service":"checkout"}\n'
```

The satellite forwards the lines to the core, where they land in the stream the
token belongs to. Confirm ingestion the same way as step 5, on the stream's
**Overview** tab.

> [!NOTE]
> The satellite buffers forwarded telemetry in bounded in-memory buffers. If it
> disconnects from the core, buffered lines may be dropped rather than held
> indefinitely; the count surfaces as **Dropped in transit** on the stream's
> Overview page.

## Next steps

With logs flowing, attach a **Log Stream** health check to a system and assert on the stream's metrics. See [Log health checks](/checkstack/user-guide/concepts/log-streams/#log-health-checks) for the collectors and example assertions, including how to alert when a stream goes silent.
