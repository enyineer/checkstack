---
title: Ship logs to a stream
description: Create a log stream, mint a source token, and forward logs from the OpenTelemetry Collector, Fluent Bit, Vector, curl, or rsyslog.
---

This guide takes you from nothing to logs flowing into a Checkstack log stream. You create a stream, mint a source token, point a shipper at one of the ingest endpoints, and confirm the lines arrive. For what a stream does with those lines and how to monitor them, see [Log streams](/checkstack/user-guide/concepts/log-streams/).

## 1. Create a stream

Sign in as a user who can manage log streams (the `logstream.stream.manage` access rule, held by team owners of the stream and by global stream managers). Open **Reliability > Log Streams** in the sidebar and create a stream. Give it a name; you can leave the sampling and retention settings on their defaults and change them later.

## 2. Mint a source token

Open the stream, go to its **Settings** tab, and mint a token under the Tokens section. The full secret is shown only once and starts with `ckls_`. Copy it now and store it wherever your shipper reads secrets; Checkstack keeps only a hash and cannot show it again. If you lose it, mint a new token and revoke the old one.

> [!CAUTION]
> A source token grants ingest access to this one stream. Treat it like a password: never commit it, and revoke it if it leaks. Revoking takes effect within about a minute.

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

The syslog listener is off by default; an operator enables it by setting `CHECKSTACK_LOGSTREAM_SYSLOG_PORT` (see [Enabling syslog](#enabling-syslog)). The source token rides in an RFC 5424 structured-data element with the SD-ID `checkstack@50501`.

```text
# /etc/rsyslog.d/checkstack.conf
template(name="checkstackFmt" type="string"
  string="<%PRI%>1 %TIMESTAMP:::date-rfc3339% %HOSTNAME% %APP-NAME% %PROCID% %MSGID% [checkstack@50501 token=\"ckls_...\"] %msg%\n")

action(type="omfwd"
  target="checkstack.example.com" port="6514" protocol="tcp"
  template="checkstackFmt")
```

If your shipper cannot emit structured data, Checkstack also accepts the token as a `@ckls_...@ ` prefix on the message text; the prefix is stripped before the line is stored.

## 5. Confirm ingestion

Back in the stream's **Overview** tab you should see the last-received time update and severity counts start climbing within a few seconds. Use the **Explore** tab to search the raw lines, and **Patterns** to see the templates Checkstack learned. Remember that `info` and `debug` lines are sampled in the raw explorer while the aggregate counts on Overview are complete.

## Limits and backpressure

The endpoints protect the platform, so a well-behaved shipper should handle these responses:

- **`429 Too Many Requests`**: the per-pod ingest buffer is saturated or the stream's soft rate limit (60,000 lines per minute by default) was exceeded. Respect the `Retry-After` header and back off; most shippers do this automatically.
- **`413 Payload Too Large`**: a request body exceeded 10 MB compressed (or 50 MB after gzip decompression). Send smaller batches.
- **`401 Unauthorized`**: the token is missing, malformed, or revoked.
- **`400 Bad Request`**: the body could not be parsed. The OTLP endpoint accepts partial batches and reports rejected records in its `partialSuccess` response rather than failing the whole request.

Individual lines longer than the stream's max line size (32 KB by default) are truncated, and oversized attribute blobs are capped. Neither is an error; the line is still stored.

## Enabling syslog

The syslog listener runs only when an operator sets `CHECKSTACK_LOGSTREAM_SYSLOG_PORT` on the Checkstack backend. Optional TLS is configured with `CHECKSTACK_LOGSTREAM_SYSLOG_TLS_CERT` and `CHECKSTACK_LOGSTREAM_SYSLOG_TLS_KEY`, and the bind host with `CHECKSTACK_LOGSTREAM_SYSLOG_HOST` (defaults to `0.0.0.0`).

```env
CHECKSTACK_LOGSTREAM_SYSLOG_PORT=6514
CHECKSTACK_LOGSTREAM_SYSLOG_TLS_CERT=/etc/checkstack/syslog.crt
CHECKSTACK_LOGSTREAM_SYSLOG_TLS_KEY=/etc/checkstack/syslog.key
```

The listener frames RFC 5424 messages by either octet-counting (RFC 6587) or newline delimiting, so most syslog daemons work without extra configuration. Messages with no resolvable token are dropped.

## Forward logs through a satellite

If your logs originate inside a network zone that cannot reach the core directly
(a customer VPC, a segmented environment), run a [satellite](/checkstack/user-guide/concepts/satellites/)
in that zone and let it forward the logs over its outbound WebSocket. Shippers
then target the satellite instead of the core, so the zone needs no inbound
firewall hole to Checkstack.

The satellite is a relay, not a new trust boundary: it forwards the same `ckls_`
source token your shipper would otherwise send to the core, and the core verifies
it identically (revocation included). Mint the token exactly as in step 2 above.

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
syslog listener:

```env
CHECKSTACK_SATELLITE_SYSLOG=1
CHECKSTACK_SATELLITE_SYSLOG_PORT=6514
```

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
