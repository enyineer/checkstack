---
"@checkstack/ingest-utils": minor
"@checkstack/logstream-backend": minor
---

Extract the source-agnostic ingest primitives into a new foundation-layer
package `@checkstack/ingest-utils`, and refactor log-stream ingest to consume
them. This is an internal refactor: log-stream behavior is unchanged (token
format `ckls_`, cache-key strings, HTTP status semantics, buffer/flush timing,
worker offload, ids, and migrations are all byte-identical), and
`@checkstack/logstream-common`'s public exports are untouched.

`@checkstack/ingest-utils` (BACKEND-ONLY - it imports `node:crypto` /
`node:zlib`, so it must never be imported by a browser bundle) provides:

- `createSourceTokenKit({ prefix })` - the node:crypto side of a source-token
  scheme (generate/hash + the format helpers), parameterized by prefix so each
  ingest plugin mints its own tokens. The browser-safe FORMAT half stays in each
  plugin's `*-common`.
- `createIngestAuthenticator` + `NegativeTokenCache` + the coordinated
  `ingest-token:` / `ingest-token-miss:` cache-key builders and the
  plugin-scoped `createIngestTokenCache`.
- `RateLimiter` (per-key soft limit) and `PreAuthRateLimiter` (per-IP pre-auth
  abuse limiter).
- `readCappedBody` (size-capped body reader with async gunzip + inflated cap).
- A generic bounded line+byte `IngestBuffer<T>` with per-key fair share.
- `createFlushLoop` (the timer + single-inflight flush skeleton).
- The OTLP wire codec (`ProtoReader` / `ProtoWriter`) and the signal-agnostic
  OTLP structure readers (`AnyValue` / `KeyValue` / `Resource`, the recursion
  depth guard) plus `encodeExportServiceResponse`.

`@checkstack/logstream-backend` now delegates to these: its `token-crypto`,
`ingest/auth`, `api/token-cache`, `ingest/buffer`, `ingest/rate-limit`,
`ingest/http/body`, and `ingest/protobuf/wire` become thin re-export/adapter
shims that preserve their existing names and shapes; the OTLP logs decoder keeps
only its logs-specific message decoding; and the ingest pipeline consumes
`createFlushLoop` for its timer/inflight mechanism while keeping its
drain/worker-specific orchestration. The full log-stream backend suite (unit +
integration + the load guard) passes unchanged.
