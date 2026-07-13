---
"@checkstack/logstream-common": minor
"@checkstack/logstream-backend": minor
"@checkstack/logstream-frontend": minor
---

Add log streams: push high-volume application and infrastructure logs to
Checkstack and monitor them as health checks. Operators create a stream, mint a
per-stream source token (`ckls_...`, shown once, sha256 at rest), and ship logs
over OTLP/HTTP (`/api/logstream/v1/logs`, JSON + protobuf + gzip), a native
NDJSON/JSON endpoint (`/api/logstream/ingest`), or RFC 5424 syslog over TCP/TLS
(enabled with `CHECKSTACK_LOGSTREAM_SYSLOG_PORT`).

Ingestion is event-driven and cheap: a bounded per-pod write buffer flushes each
stream in one transaction, folding every line into complete per-minute severity
and pattern aggregates while keeping a capped, sampled subset of raw lines
(WARN+ always, INFO/DEBUG sampled) for the log explorer. The Drain engine groups
lines into message patterns whose ids are deterministic hashes of the template,
so per-pod parse trees converge across a horizontally-scaled deployment without
coordination.

Per-stream `severityRules.valueMap` remapping is honored by every protocol,
keyed on the source's native severity value: OTLP `severityText`, the native
`level`/`severity` field, and (for syslog) the RFC 5424 severity keyword derived
from the PRI (`err`, `warning`, ...), so `{ "err": "fatal" }` re-bands syslog
error lines.

A `logstream` health-check strategy exposes the stream to the existing pipeline.
Its `window-metrics` collector surfaces assertable windowed metrics
(`errorCount`, `errorRatePerMinute`, `secondsSinceLastLog`, pattern counts, and
more) and a `pattern-occurrence` collector counts a single pattern. Health is a
periodic read of pre-aggregated buckets that emits one run per tick, with a
debounced error fast-path for near-real-time reaction to bursts and absence
asserted via `secondsSinceLastLog`. Streams are a team-scopable RLAC resource;
retention and minute-to-hour rollup run as recurring maintenance jobs. The
frontend adds a Log Streams area under Reliability with stream list, overview,
explorer, patterns, and settings (token minting plus copy-paste shipper
snippets).
