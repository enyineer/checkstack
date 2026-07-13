# @checkstack/logstream-frontend

## 0.1.0

### Minor Changes

- 4568dcc: Render the log-stream health-check config as real dropdowns. The check editor
  now forwards dynamic-option resolvers to its strategy and collector config
  forms, so the `logstream` strategy's **stream** field and the
  `pattern-occurrence` collector's **pattern** field become pickers instead of
  plain text inputs.

  The health-check editor gains a contribution point,
  `HealthCheckConfigOptionsResolverSlot`: a plugin that registers a strategy whose
  config declares `x-options-resolver` fields contributes a factory that turns the
  editor's generic context (the RPC api plus the current strategy config) into the
  concrete resolvers. The editor stays ignorant of any specific strategy - the
  owning plugin supplies the resolvers, mirroring the backend extension-point
  pattern. Because the editor passes the strategy config down to the collector
  forms, a collector-field resolver can read a selection made in the sibling
  strategy form (the pattern picker lists the chosen stream's Drain patterns).

  `logstream-frontend` contributes the `logstreamStreamId` and
  `logstreamPatternId` resolvers, backed by the `typeScoped` `listStreamsForPicker`
  and `listPatterns` procedures, and `logstream-common` now exports the shared
  strategy id and resolver-name constants so the backend annotations and the
  frontend resolvers reference one source and cannot drift.

- 4568dcc: Add log streams: push high-volume application and infrastructure logs to
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

- 4568dcc: Add per-resource scoping to realtime signal auto-invalidation. Signals may now
  declare an optional `resourceKey` extractor (`createSignal({ ..., resourceKey })`);
  when a received signal carries one and it yields an id, `SignalAutoInvalidator`
  narrows invalidation from the whole owning plugin's react-query cache to only
  the queries whose key contains that resource id, plus queries that opted into
  whole-plugin refresh with `meta: { signalScope: "plugin" }` (exported as
  `signalScopeMeta`). A plugin registers its resource-scoped signal defs on its
  frontend config's new `signals` field so the invalidator can recover the
  extractor from a received signal's id. The invalidation coalescer now buckets on
  `pluginId` + `resourceId`, so bursts for different resources stay independent.

  This is fully backward compatible: a signal WITHOUT a `resourceKey` keeps the
  original blanket-plugin invalidation, so every existing signal behaves exactly
  as before. Foreign (`foreignSignals`) invalidation also stays blanket.

  Logstream adopts it: `LOGSTREAM_ACTIVITY` and `LOGSTREAM_IMPORTANT_EVENT` scope
  to their `streamId`, so a viewer on one stream's detail page is no longer
  refetched (including the heavy list-page summaries) whenever any other stream
  ingests. The stream list page opts its two resource-agnostic queries back into
  whole-plugin refresh with `signalScopeMeta`.

### Patch Changes

- 4568dcc: Surface satellite in-transit log drops on the log stream overview, mirroring
  metricstream. When a satellite forwards logs and its bounded in-memory buffer
  drops lines during a disconnect / slow-consumer episode, the agent reports the
  per-stream counts as `droppedByGroup` on the telemetry batch (keyed by stream
  token). The logstream satellite handler previously ignored it, so operators got
  no signal that forwarded logs were lost.

  - `log_stream_activity` gains a `dropped_in_transit_count` column (additive
    forward-only migration; safe on populated tables).
  - The satellite telemetry handler resolves each `droppedByGroup` token to its
    stream and records the loss against THAT stream via a best-effort
    `addInTransitDrops` upsert (atomic, cross-pod safe; a bookkeeping write never
    fails an accepted batch). A token that no longer resolves to a stream is left
    unattributed rather than charged to another stream.
  - The stream overview read model exposes `droppedInTransitCount`, and the
    overview tab renders a "Dropped in transit" tile (warn tone when > 0).

- Updated dependencies [a74fa01]
- Updated dependencies [4568dcc]
- Updated dependencies [a74fa01]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [a74fa01]
- Updated dependencies [4568dcc]
- Updated dependencies [a74fa01]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [d00e099]
  - @checkstack/healthcheck-frontend@0.36.0
  - @checkstack/ui@1.28.0
  - @checkstack/logstream-common@0.1.0
  - @checkstack/auth-frontend@0.13.4
  - @checkstack/frontend-api@0.16.0
  - @checkstack/signal-common@0.3.0
  - @checkstack/common@0.22.0
