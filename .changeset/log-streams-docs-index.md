---
"@checkstack/ai-backend": patch
---

Regenerate the assistant's docs index to cover the new log-streams content: the
Log streams concept page (tiered storage, Drain patterns, important events,
source tokens, log health checks, absence, retention), the Ship logs to a stream
guide (OTel Collector, Fluent Bit, Vector, curl, and rsyslog configs plus
backpressure and size limits), and the Log streams backend architecture
reference (ingestion pipeline, state-and-scale answers, Drain convergence, health
integration, retention jobs, RLAC, and the token cache convention).
