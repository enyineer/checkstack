---
"@checkstack/satellite": minor
"@checkstack/logstream-backend": minor
"@checkstack/logstream-common": minor
---

Satellite telemetry forwarding, agent side + the logstream core handler.

`@checkstack/satellite` gains the local telemetry receivers and the metric
scraper, each behind its capability env flag and forwarding into the ONE
credit-window telemetry client (nothing touches the health-result path):

- HTTP receivers on one port (`CHECKSTACK_SATELLITE_RECEIVER_PORT`, default
  4318) when `CHECKSTACK_SATELLITE_LOG_RECEIVERS=1`: OTLP logs `/v1/logs`,
  native logs `/ingest`, OTLP metrics `/v1/metrics`, native metrics
  `/ingest/metrics`. The agent parses with the shared parsers, requires a
  `ckls_`/`ckms_`-SHAPED token (401 otherwise) and answers 202 after buffering;
  it does not (cannot) verify the token - the core handler does, so a
  core-rejected token is a documented "202-then-drop" surfaced as a counted
  drop.
- A TCP/TLS syslog listener when `CHECKSTACK_SATELLITE_SYSLOG=1`
  (`CHECKSTACK_SATELLITE_SYSLOG_PORT` + `_TLS_CERT`/`_TLS_KEY`/`_HOST`), reusing
  the shared RFC 6587 framer + RFC 5424 parser and forwarding lines grouped by
  the token each message carried.
- A metric-scrape scheduler when `CHECKSTACK_SATELLITE_SCRAPE=1`: consumes the
  `metric-scrape` capability config the core pushes (the targets bound to this
  satellite), reconciles one interval timer per target, and runs an SSRF-guarded
  scrape executor (same `resolveAndValidateHost` egress guard, timeout, size cap,
  and `capScrapeSeries` shaping as the core reconciler), forwarding datapoints
  and per-target status. Concurrent scrapes are capped (default 4); a transport
  failure is reported as `lastError` (never a metric).

`@checkstack/logstream-backend` registers the "logstream" satellite capability
handler against `satelliteCapabilityExtensionPoint`: it verifies each forwarded
group's `ckls_` token with the existing ingest authenticator (revocation
intact), re-clamps timestamps against the core clock, re-applies the stream's
severity `valueMap`, and feeds the SAME ingest pipeline the HTTP endpoints use.
Ack semantics mirror HTTP - a token rejection is terminal (dropped + counted);
a whole-batch saturation that wrote nothing is retryable (safe, nothing was
buffered); any partial accept is terminal so a resend never double-writes.

`@checkstack/logstream-common` gains the shared `satellite-relay` wire contract
(`SatelliteLogLine`/`SatelliteLogBatch` + `toWireLogLine`) used by both the
agent receivers and the core handler.
