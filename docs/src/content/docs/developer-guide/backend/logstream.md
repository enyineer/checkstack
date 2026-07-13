---
title: Log streams backend
description: Architecture of the log-stream ingestion pipeline, Drain pattern engine, health integration, retention jobs, and RLAC model.
---

The log-stream plugin ingests high-volume logs, aggregates them into per-minute counters, groups lines into Drain patterns, keeps a capped sample of raw lines, and exposes each stream as a health-check strategy. It lives in three packages: `logstream-common` (contracts, schemas, access rules, severity and token helpers), `logstream-backend` (ingestion, storage, Drain, health, API), and `logstream-frontend`. This page documents the backend design and the invariants that keep it correct under horizontal scale.

The controlling design decision is that health is never evaluated per line. Ingestion is event-driven and cheap; health evaluation is a periodic read of pre-aggregated counters that emits one ordinary health-check run per tick, so the existing assertion, status, anomaly, incident, and status-page pipeline works unchanged. For the user-facing model see [Log streams](/checkstack/user-guide/concepts/log-streams/).

## Package layout

The backend plugin is thin orchestration (`src/index.ts`): it builds the shared storage, important-event recorder, and Drain engine, then hands each area its setup function.

- `src/storage/` builds the batch-insert, bucket-upsert, activity-touch, and windowed-read helpers used by ingest, health, and the API.
- `src/drain/` is the pattern engine (masking, the fixed-depth parse tree, persistence sync).
- `src/ingest/` owns the raw HTTP handlers, token auth, the per-pod buffer and flush worker, and the syslog listener.
- `src/health/` registers the strategy and collectors, the fast-path hook, the silence detector, and the retention/rollup jobs.
- `src/api/` is the oRPC router and service (CRUD, token lifecycle, viewer reads) plus the token-cache convention.

## Ingestion pipeline

### Endpoints

Raw handlers are registered with `rpc.registerHttpHandler(handler, path)` and mount at `/api/logstream{path}`:

- `POST /api/logstream/v1/logs` accepts OTLP `ExportLogsServiceRequest` as `application/json` or `application/x-protobuf`, optionally gzipped, and replies with an `ExportLogsServiceResponse` in the same content type, carrying `partialSuccess` when some records were dropped.
- `POST /api/logstream/ingest` accepts native `application/x-ndjson` (one JSON object per line) or `application/json` (a bare array, a `{ logs: [...] }` envelope, or a single object), optionally gzipped, and replies `202` with `accepted` and `rejected` counts.

Both read the body through a size-capped reader (`src/ingest/http/body.ts`) that enforces a 10 MB compressed cap and, for gzip, a 50 MB inflated cap via `zlib`'s `maxOutputLength` so a decompression bomb is refused before exhausting memory. Oversize yields `413`, a wholly-unparseable body yields `400`, buffer saturation or a soft rate-limit breach yields `429` with `Retry-After`.

The syslog listener (`src/ingest/syslog/listener.ts`) is created only when `CHECKSTACK_LOGSTREAM_SYSLOG_PORT` is set. It binds a `Bun.listen` TCP socket (TLS when a cert and key are configured), frames RFC 5424 messages by octet-counting or LF, and resolves the source token from the `checkstack@50501` structured-data element or a `@ckls_...@ ` message prefix. Every pod binds its own socket on the same port behind a load balancer, so no cross-pod coordination is needed; to avoid a port clash the listener binds only on the default instance, not on preview instances.

### Auth

The ingest handlers have no RBAC principal. The source token is the authorization, scoped to ingest for exactly one stream. `extractIngestToken` pulls a `ckls_`-shaped token from the `Authorization: Bearer` or `X-Checkstack-Token` header, and the authenticator hashes it with sha256 and looks the hash up. Verdicts are cached in the shared plugin-scoped cache under `ingest-token:<sha256hex>` (see [Token cache convention](#token-cache-convention)), so the hot path does no per-request database work. There is no bcrypt on this path. A token's `lastUsedAt` is updated at most once per flush cycle, never per request.

### Buffer and flush

Normalized lines are admitted into a bounded per-pod buffer (line and byte capped). A flush runs every 500 ms, or immediately when the buffer reaches 1,000 lines. Each flush drains the buffer per stream and, for each stream, does exactly one `withScopedTransaction`:

1. Classify every line through the Drain engine to a `patternId` (with its wildcard values), and queue any new or refined pattern rows. Severity pattern overrides from the stream's severity rules are applied here, before anything downstream sees the band.
2. Fold per-minute severity, pattern, and pattern-variable deltas in memory, then upsert them with `INSERT ... ON CONFLICT DO UPDATE` accumulation (a few rows, never per line). Numeric wildcard values fold into per-`(pattern, variable, minute)` count/sum/min/max buckets that back the pattern-metric collector.
3. Select which raw lines to persist (the sampler; see below) and insert them in one multi-row statement, chunked.
4. Touch the one-row-per-stream activity record.

The flush is split so a failed write can be retried without re-running the non-idempotent Drain classification: `prepareFlush` mutates the engine exactly once and produces a plan; `writeFlush` applies the plan in one transaction and is safe to retry. The classify loop yields to the event loop periodically so even a full-buffer flush cannot stall the pod. On a first write failure the flush retries once after a short backoff; on a second failure it drops the batch, increments a dropped counter, and logs, but never crashes the ingest path and never holds more than one in-flight flush. Error-spike detection runs after commit in its own read.

### Worker offload

The offloadable flush stage (Drain classification, severity pattern overrides, sampling selection, and the per-minute folds) runs behind a `FlushExecutor` seam with two implementations: in-process, and a pool of Bun workers sharded by stream id so each stream's Drain tree lives in exactly one worker. `CHECKSTACK_LOGSTREAM_INGEST_WORKERS` sets the pool size (default 1; 0 forces in-process). Parsing, auth, rate limiting, backpressure, and every database write stay on the main thread - the synchronous accepted/rejected response contract and shed-at-the-door budgets are unchanged, and workers hold no database connections (pattern hydration round-trips through the main thread, bounded per stream).

A crashed worker is respawned and its streams re-hydrate lazily; in-flight work is dropped and counted (the same bounded-loss class as a failed write). Repeated crashes mark the slot dead and route its streams to the in-process fallback. Executor-held protection state is treated as ephemeral: the pool bumps a per-slot protection epoch on every crash, and the pipeline re-pushes the healthcheck-referenced protected set on the next flush, so a respawn can never silently disarm pattern protection.

Important events (`new_pattern`, `spike`), the health fast-path hook, and a debounced `LOGSTREAM_ACTIVITY` signal (at most one broadcast per stream every 2 seconds) all fire only after the transaction commits.

### Raw-line sampling

Aggregates carry full volume; raw `log_events` rows are a capped sample selected by `src/ingest/sampler.ts`:

- `warn` and above is always kept.
- `info`, `debug`, and `trace` keep the first 3 lines per `(pattern, minute)` plus a random sample at the stream's `infoSampleRate`.
- A per-stream `maxRawPerMinute` cap bounds kept rows; sampled overflow is dropped and counted (`warn`-and-above is never dropped).

The sampler's per-minute counters span the roughly 120 flushes in a minute, so it is stateful and pod-local; old minutes are pruned to bound memory.

### Responsiveness load guard

`src/ingest/load-guard.it.test.ts` is an integration guard that hammers the real end-to-end ingest path (native handler, auth, parse/normalize, buffer, flush worker, storage) against real Postgres and asserts that high ingest volume does not degrade the rest of the application. It runs in the standard integration lane alongside every other `*.it.test.ts`, in its own throwaway schema, and takes about 15 seconds.

The guard has two deliberately separated phases:

- **Phase A, responsiveness under sustained absorbable load.** Producers are paced to a genuinely high but sustainable rate (about 10,000 lines per second, well above the 3,000 to 5,000 floor) that the pipeline fully accepts. It asserts a tight event-loop p95 delay (`monitorEventLoopDelay`, bound 150 ms; healthy is low-tens of ms) and a fast control-path probe.
- **Phase B, backpressure under an overload burst.** Producers then hammer as fast as the process allows for a short burst, far above the drain rate. It asserts that overload is shed as `429`s, that every offered line is accounted for (`accepted + rejected == offered`), and that RSS growth stays bounded, never asserting the tight event-loop bound here.

Throughout both phases a concurrent probe issues a non-ingest read (`getStream`) on the same database pool and asserts its p95 latency and zero failures. The probe is the direct proxy for "does the rest of the app degrade". After the load stops, a final flush is drained and the guard asserts integrity: the persisted severity-bucket total equals the accepted line count (no accepted data lost), and the stream activity row was updated.

The two phases exist because shedding and a calm event loop are in tension: shedding requires a full write buffer, and a flush of a full buffer classifies up to the buffer cap (20,000 lines) synchronously in `prepareFlush`, so the overload regime intrinsically shows a higher event-loop delay (measured around 270 ms p95 under an in-process firehose) even though the control-path probe stays fast. This is a characteristic of the current whole-buffer synchronous flush, not a regression; if the loop must stay calm even under shed-level overload, the lever is chunking or yielding the flush classification loop.

Run it locally against the dev-compose Postgres:

```bash
docker compose -f docker-compose-dev.yml up -d postgres redis
CHECKSTACK_IT=1 bun test load-guard
# quicker local pass with a shorter Phase A window:
CHECKSTACK_IT_LOAD_MS=3000 CHECKSTACK_IT=1 bun test load-guard
```

## State and scale

The platform runs as N pods sharing one database. The pipeline's answers to the three [state-and-scale](/checkstack/developer-guide/architecture/) questions:

1. **Where does the current state live?** All durable state is in the plugin's Postgres tables: severity and pattern buckets (minute and hourly), raw `log_events`, `log_patterns`, `log_important_events`, and the one-row-per-stream `log_stream_activity`. The in-memory structures (the write buffer, the raw sampler's per-minute counters, the rate limiter, the token-use tracker, the per-pod ingest counters, and the Drain parse tree) are short-lived pod-local bookkeeping and a write buffer, never a queryable source of truth.

2. **Does a read return the same answer on every pod?** Yes. Every health, chart, and viewer read resolves from the shared buckets and tables, so it is identical on every pod. Each pod flushes only its own intake into those shared tables. The only pod-local values ever surfaced are the approximate ingest counters on the overview page, which are explicitly labeled per-pod and approximate; the durable rates come from the buckets.

3. **Is anything duplicated?** The Drain tree is duplicated per pod by design (throughput), but it is not a source of truth: templates persist to `log_patterns`, and because a pattern id is a pure hash of `(streamId, template)`, independently-built trees converge on identical ids in Postgres. Near-duplicate clusters across pods before convergence are accepted v1 slack.

## Drain engine

The engine (`src/drain/`) implements Drain (fixed-depth parse tree) tuned for streaming.

Before a line enters the tree, `maskAndTokenize` masks variable substrings to a single wildcard class `<*>` and splits on whitespace. Masking rules run broad-to-narrow (quoted strings, URLs, emails, UUIDs, ISO timestamps, IPv6, IPv4, hex runs of 4+ that contain a digit, then plain numbers) so a match cannot be re-split by a later rule, and the token count is capped to bound similarity scoring. A cluster's template joins its tokens with wildcards where lines differ; the pattern id is `sha256(streamId + " " + template)`.

The parse tree is per-pod and in-memory for throughput. On a stream's first line after boot the engine hydrates that stream's tree from `log_patterns` (concurrent first-lines await a single load, bounded to the most recently seen rows), and new or refined pattern rows accumulate as deltas that `prepareFlush` drains and the flush transaction upserts via `storage.upsertPatterns`. Because the pattern id is deterministic, per-pod trees need no cross-pod coordination to converge. Template refinement is rare after warmup and never rewrites history: old bucket rows keyed on the previous id stay, and the new template's pattern row is upserted. Classification also returns the raw value at each wildcard position of the matched template; the flush folds the numeric ones into the pattern-variable buckets.

### Custom and protected patterns

User-authored patterns (`origin: 'user'`, capped per stream) are installed as protected clusters: they match first within their leaf by exact wildcard-aware comparison, are never similarity-matched or template-refined, and are never evicted. Authoring one on any pod reaches every other pod through the `logstream.patterns.changed` broadcast, with hydration as the convergence backstop. Creating a template that already exists as a mined pattern promotes the existing row in place, keeping its id and history.

Protection extends to any pattern referenced by a health check, mined or user-authored: the health integration resolves the referenced set (cached, via `HealthCheckApi`), the pipeline pushes it into the engine per stream, retention excludes those ids from the stale-pattern sweep, and `deletePattern` refuses while a reference exists. Both eviction layers respect protection; under global memory pressure a protected-holding stream sheds its non-protected clusters while the protected core stays resident (evicted mined clusters re-mine safely because the id derivation is deterministic; user clusters re-hydrate from their durable rows). The API-side dry-run matcher (`testPattern`) and the classifier share one matcher module, so a preview can never disagree with ingestion.

## Health integration

### Strategy

`LogStreamHealthStrategy` registers as `logstream.logstream` ("Log Stream", category Observability) via `healthCheckRegistry`. It probes nothing. `createClient` validates the config, resolves the stream (a cheap existence check), and returns a read handle over the storage helpers. The single failure mode is a config error: if the referenced stream was deleted, `createClient` throws, which the executor treats as a connection failure and short-circuits to unhealthy before assertions run. This is the only correct use of a thrown error here, per the [collector rule](/checkstack/developer-guide/backend/healthchecks/collectors/): a missing target is a transport failure, but a zero count or a silent stream is a metric.

### Collectors

Three collectors register via `collectorRegistry`, scoped to the strategy:

- **`window-metrics`** reads severity and pattern aggregates over a window and exposes `totalCount`, `fatalCount`, `errorCount`, `warnCount`, `infoCount`, `debugCount`, `errorRatePerMinute`, `secondsSinceLastLog`, `newPatternCount`, and `distinctPatternCount`, all numeric, chart-annotated, and assertable. `error` and `fatal` counts and the error rate opt into anomaly detection (lower-is-better); volume-dependent counts stay chart-only.
- **`pattern-occurrence`** counts one chosen pattern over the window and exposes `occurrenceCount` and `minutesSinceLastSeen`.
- **`pattern-metric`** aggregates the numeric values at one wildcard position of one pattern and exposes `avgValue`, `minValue`, `maxValue`, and `sampleCount`. A zero-sample window reports zeros with `sampleCount: 0` (pair value assertions with a `sampleCount` assertion); anomaly detection is disabled on the value fields because their domain is arbitrary. Only STANDALONE `<*>` tokens are variables: a wildcard embedded inside a token (`db-<*>`, produced by in-token masking) keeps its static text and its value is never extracted, so it has no `varIndex` and cannot be aggregated. `listPatternVariables` numbers the standalone positions 0-based left to right, returns a template context snippet per position (so the editor can show WHICH `<*>` a variable is), and reports the summary window it covered (`summaryWindowSeconds`); the editor renders "no samples in the last <window>" for a position whose numeric buckets are older than that window.

The window defaults to the check interval and is floored to whole minutes with a one-minute minimum; counts cover the complete minutes plus the in-progress minute, so a burst is visible to the fast-path immediately while rate denominators stay anchored to complete minutes (`src/health/window.ts`). `secondsSinceLastLog` falls back to seconds-since-stream-creation for a never-received stream rather than emitting a sentinel, so an absence assertion is meaningful from creation. Any read rejection propagates as a transport failure; zero rows are a metric.

Absence is expressed as an assertion on `secondsSinceLastLog` (for example, less than 600), not as a distinct collector mode.

### Fast-path

`createFastPath` builds the `onIngestFlush` hook the pipeline calls post-commit. When a flush's worst band is `error` or worse, it resolves the enabled assignments of the enabled logstream configurations that reference the stream and enqueues a one-off evaluation for each. Discovery uses the sanctioned domain-to-common RPC path (`HealthCheckApi`), cached 60 seconds per stream. The payload mirrors healthcheck-backend's one-off run shape, and the runs are enqueued directly onto the shared `health-checks` queue (the queue is a single global BullMQ queue, not plugin-namespaced). The debounce is the job id: `logstream-fast:{configId}:{systemId}:{floor(now / 15s)}`, so every flush in the same 15-second bucket collapses to one enqueued evaluation per assignment.

The queue name and payload shape are re-declared in `src/health/constants.ts` on purpose: importing `healthcheck-backend` would violate the domain-to-domain dependency rule, so the small shared contract is mirrored and guarded by the fast-path integration test.

### Maintenance jobs

`registerMaintenanceJobs` schedules three recurring passes on the plugin's own `logstream-maintenance` queue, idempotently (a stable job id per pass means every pod converges to one schedule):

- **Silence** (every 60 s) records `silence` and `silence_recovered` important events only. Health for absence is already handled by assertions on `secondsSinceLastLog`; this pass only maintains the viewer timeline, deduped via the activity row's `silenceEventAt` marker (silent after 15 minutes with no lines).
- **Rollup** (hourly) folds minute buckets past `minuteRetentionHours` into hourly buckets.
- **Cleanup** (daily) deletes expired raw events (batched at 5,000 per statement), expired hourly buckets and important events past `hourlyRetentionDays`, and stale patterns not seen since the hourly cutoff that also have no remaining bucket rows.

The rollup uses `INSERT ... SELECT ... ON CONFLICT DO UPDATE` to sum minute rows into the hour before deleting the minute rows, so counts are never lost across the tier boundary. All deletes are forward-only, following the healthcheck retention precedent.

## API and RLAC

The oRPC contract is `logstream-common/src/rpc-contract.ts`. The stream is the only team-scopable resource; tokens, events, patterns, and buckets are all scoped by their owning `streamId`.

The resource type and both access rules use the same noun, `stream`, so grants key on `logstream.stream` and the frontend gates check the same type (the keying rule in the [RLAC guide](/checkstack/developer-guide/security/)). Each write procedure declares exactly one `instanceAccess` mode:

- `createStream` uses `create` (an owning team is written for the new id).
- `updateStream`, `deleteStream`, and the token procedures use `idParam` on the stream id under the `manage` rule.
- `listStreams` and `listStreamSummaries` use `listKey` (each summary is keyed on `id`, the stream id, so the post-filter works for team-scoped callers).
- The viewer reads (`searchEvents`, `getSeverityBuckets`, `getPatternBuckets`, `listPatterns`, `listImportantEvents`, `getStreamOverview`) use `idParam` under the `read` rule.
- `listStreamsForPicker` uses `typeScoped`, so a team-scoped stream manager can populate the health-strategy stream dropdown without holding the global rule.

The backend registers a `resourceResolverRegistry` entry under `logstream.stream` so the Teams UI can render grant names. Source tokens are a separate ingest-only authorization and are never RBAC principals.

## Token cache convention

Both the ingest auth path and the API revoke/delete path build the same plugin-scoped cache with `createIngestTokenCache` and key token verdicts with `ingestTokenCacheKey(tokenHash)` (`ingest-token:<sha256hex>`). Sharing the builder and key means revoke and delete-stream invalidate the exact scope and key the ingest path caches under, event-driven and cross-pod (the cache is the shared platform cache), so a revoked token stops authenticating on the next HTTP request - the same weld-the-write-to-its-invalidation pattern the auth role cache uses. The 60 second TTL is only a backstop for a cache outage, not the revocation mechanism. Do not hand-roll a different key or a raw provider key that would miss the scope prefix.

Two narrow windows remain TTL-bounded because they live in pod-local memory that a shared-cache invalidation cannot reach: a long-lived syslog connection re-verifies its per-connection verdict at most every 60 seconds (a revoked token can keep ingesting on an already-open connection for up to that long), and the per-pod negative cache for unknown token hashes expires within 30 seconds (only relevant to a token minted moments after its hash was probed, which mint also clears from the shared miss marker).
