---
"@checkstack/backend-api": minor
"@checkstack/healthcheck-backend": patch
---

Promote the t-digest percentile helpers from healthcheck-backend into
backend-api (`createTDigest`, `serializeTDigest`, `deserializeTDigest`,
`mergeTDigestStates`, `percentileFromState`, ...), so any plugin can maintain
mergeable percentile sketches; tracestream's per-operation p95 buckets are the
first new consumer. healthcheck-backend now imports the shared module (the
local copy is removed, no behavior change).
