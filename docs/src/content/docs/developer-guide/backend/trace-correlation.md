---
title: Trace correlation
description: How logs, traces, and health-check runs link to each other - trace-id extraction, cross-stream lookups, correlation slots, and the HTTP probe's traceparent header.
---

Checkstack correlates its three signals through W3C trace context: log
events carry `traceId`/`spanId` columns, trace streams index full traces,
and health-check HTTP probes stamp each request with a `traceparent`
header. This page describes the seams that connect them and how plugin
authors extend each one.

## How log events get trace ids

Log events store `traceId` and `spanId` (nullable columns on
`log_events`, backed by a partial index over rows where a trace id is
present). Ids arrive through three mechanisms, in priority order:

1. **OTLP**: the logs endpoints decode `LogRecord.trace_id` /
   `span_id` (protobuf fields 9/10, JSON `traceId`/`spanId`) directly.
2. **Native reserved keys**: the native NDJSON parser lifts literal
   `traceId`/`trace_id`/`spanId`/`span_id` top-level keys.
3. **Per-stream extraction rules** (`config.traceExtraction`): for
   sources that carry ids in nonstandard places, a stream can declare
   per-field rules that run at the ingest flush seam - the single
   convergence point of every ingest path (native HTTP, syslog, OTLP,
   telemetry sinks, satellite relay). Rules never overwrite an id the
   line already carries.

An extraction rule per field (`traceId`, `spanId`) offers two probes:

```ts
// logstream-common: LogStreamConfigSchema.traceExtraction
{
  traceId: {
    // Dot-notation paths into the line's attributes, tried in order.
    attributePaths: ["ctx.trace_id", "request.traceId"],
    // Fallback: regex over the line body; capture group 1 is the id.
    bodyRegex: "trace[_-]id[=:]\\s*([0-9a-fA-F-]{16,36})",
  },
  spanId: { attributePaths: ["ctx.span_id"] },
}
```

Guard rails: the regex must compile, contain a capture group, and pass
a backtracking-safety analysis (all validated by zod at config-save
time). The analysis rejects the super-linear classes - backreferences,
any quantifier over a group containing a quantifier or alternation
(`(a+)+`, `(a|b)+` - use `[ab]+`), and more than two unbounded
quantifiers - because the pattern runs inside the shared ingest flush
worker, where a catastrophic-backtracking pattern would stall ingest
for every stream. The regex only ever sees the first 4096 characters
of the body, extracted ids are trimmed, dash-stripped and lowercased,
and ids longer than 64 characters are discarded. A rule that stops
compiling is treated as absent rather than failing the flush.

## Cross-stream lookups

Two mirrored contract procedures power every correlation surface; both
return per-stream match groups post-filtered by the caller's read
grants (`instanceAccess: { listKey: "matches" }`), so a caller only
ever learns about streams they can read:

- `tracestream.findTraceById({ traceId })` - which readable trace
  streams contain this trace? Powers every "View trace" button.
- `logstream.findEventsByTraceId({ traceId, from, to, limitPerStream })` -
  which readable log streams carry events for this trace? The time
  window is required so the scan is always bounded. Grouped per stream,
  newest-first, capped per stream in SQL (window function) and to at
  most 50 stream groups, so a chatty trace or a degenerate id cannot
  flood the response.

## Correlation slots

Three frontend slots connect the signals without any plugin importing
another's frontend:

| Slot | Defined in | Filled by | Context |
| --- | --- | --- | --- |
| `TraceCorrelationsSlot` | `tracestream-common` | logstream-frontend (correlated logs) | `{ streamId, traceId, startTs, endTs, rootServiceName }` |
| `LogEventDetailSlot` | `logstream-common` | tracestream-frontend ("View trace") | `{ event }` |
| `RunDetailExtrasSlot` | `healthcheck-common` | tracestream-frontend ("View trace") | `{ run }` |

Fillers MUST self-hide (render `null`) when they have nothing to show,
and must not fire queries before their gate passes (e.g. the log-event
filler checks `event.traceId` before calling `findTraceById`). Hosts
memoize slot context; keep any values you add referentially stable.

> [!TIP]
> The window a `TraceCorrelationsSlot` filler receives is the trace's
> own span window. Pad it before querying (the logstream filler uses
> +-5 minutes) - correlated records can be timestamped slightly outside
> it due to clock skew or late flushes.

## Health-check probes emit traceparent

The HTTP request collector stamps every probe with a W3C traceparent
header, DEFAULT-ON with a per-collector opt-out
(`emitTraceparent: false`):

```text
traceparent: 00-<32 hex traceId>-<16 hex spanId>-01
```

- Ids are freshly generated per run (CSPRNG). A user-configured
  `traceparent` header (any casing) always wins and is passed through
  verbatim; in that case no trace id is recorded.
- The sent trace id is persisted on the collector result as a
  text-annotated, non-anomaly `traceId` field
  (`run.result.metadata.collectors[<entryId>].traceId`), so historical
  runs keep their link. Use `extractRunTraceIds({ run })` from
  `@checkstack/healthcheck-common` instead of reaching into that shape.
- If the probed application exports spans to a Checkstack trace stream,
  the run detail panel's "View trace" action resolves the id via
  `findTraceById` and deep-links into the trace view.

Collector authors adding trace emission elsewhere: keep the id a
**result field** - never an `error` - per the
[collectors contract](/checkstack/developer-guide/backend/healthchecks/collectors/).

## Deep links

- Open a trace: `/tracestream/<streamId>?tab=traces&trace=<traceId>`.
- Explore a stream's logs pre-filtered by trace:
  `/logstream/<streamId>?tab=explore&traceId=<traceId>`.

Both pages seed their local filter/view state from these query params
on entry.
