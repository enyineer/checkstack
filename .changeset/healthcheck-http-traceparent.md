---
"@checkstack/healthcheck-http-backend": minor
---

The HTTP request collector emits a W3C `traceparent` header on every probe,
DEFAULT-ON with a per-collector opt-out (`emitTraceparent: false`). Ids are
freshly generated per run (CSPRNG); a user-configured traceparent header
(any casing) wins and is passed through verbatim. The sent trace id is
persisted on the collector result as a text-annotated, non-anomaly
`traceId` field, powering the run detail panel's "View trace" jump when the
probed application exports spans to a trace stream.

BEHAVIOR CHANGE for existing checks: stored configs have no
`emitTraceparent` field, so they parse as `true` and every pre-existing HTTP
check starts sending the header (with the `01` sampled flag) on deploy. A
probed backend whose sampling is traceparent-driven will start sampling
probe requests, and a strict header-allowlisting gateway may reject them -
set `emitTraceparent: false` on affected checks to opt out.
