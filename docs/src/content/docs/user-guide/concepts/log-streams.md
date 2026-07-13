---
title: Log streams
description: Ship high-volume application and infrastructure logs to Checkstack, group them into patterns, and assert on windowed log metrics as health checks.
---

A log stream is a push endpoint that accepts high-volume application or infrastructure logs, stores them cheaply, and turns them into something you can monitor. Checkstack aggregates every line into per-minute counters, groups similar lines into message patterns, keeps a capped sample of raw lines for investigation, and exposes the whole stream as a health-check type so you can alert on log-derived metrics with the same assertions, incidents, and status pages you already use.

Log streams are for volume that would overwhelm a per-line pipeline: hundreds to thousands of lines per second. Nothing is evaluated per line. Ingestion is cheap and batched, and health is a periodic read of pre-aggregated counters. See [Ship logs to a stream](/checkstack/user-guide/guides/ship-logs/) for the shipper setup, and [Health checks](/checkstack/user-guide/concepts/health-checks/) for the assertion and status model that log streams plug into.

## What a stream captures

Every line you send is normalized into a common shape regardless of the protocol it arrived on:

- A **timestamp** (the event time, defaulting to when Checkstack received the line).
- A **severity band**: one of `trace`, `debug`, `info`, `warn`, `error`, `fatal`. Sources speak different severity dialects (OpenTelemetry severity numbers, free-text level names like `ERROR` or `warning`, syslog priorities), and Checkstack folds all of them into those six ordered bands so every aggregate and assertion shares one vocabulary.
- The **message body**, truncated to the stream's max line size.
- **Attributes** (structured key/value fields) and **resource** attributes such as `service.name`, plus trace and span ids when present.

### Severity rules

Applications disagree about severity. One framework logs `WARNING` where another logs `warn`; a legacy service might emit its real errors at `INFO`. Each stream can therefore carry **severity rules**, edited in its settings, that adjust how lines are banded without touching the shipper:

- **Value mapping** rewrites a source severity value to a band of your choice. If a framework says `WARNING` and you want it treated as an error, map it. Matching is case-insensitive, and each protocol is keyed on its natural severity field (the level name for JSON logs, the severity text for OpenTelemetry, the standard severity keyword for syslog).
- **Pattern overrides** re-band every line that matches a chosen pattern. This is the tool for the service that logs genuine failures at `INFO`: pick the failure pattern and mark it `error`, and those lines count as errors everywhere - in charts, assertions, sampling, and spike detection.

Severity rules apply to lines as they arrive; they do not rewrite history.

## Tiered storage

A stream keeps data at two fidelities so it can carry full volume without unbounded growth.

**Aggregates carry the full volume.** Every line increments per-minute severity counters (how many `error` lines this minute, how many `warn`, and so on) and per-minute pattern counters. These minute buckets are complete: no sampling, no loss. They are what health checks and charts read, so your metrics reflect every line even when raw storage is capped. Minute buckets are rolled up into hourly buckets as they age.

**Raw lines are a capped, investigable sample.** Storing every raw line at thousands per second is neither cheap nor useful, so Checkstack keeps a representative subset in the log explorer:

- `warn` and above are always kept. These are the lines you investigate.
- `info`, `debug`, and `trace` keep the first few lines per pattern each minute (for shape coverage) plus a small random sample of the rest, governed by the stream's sample rate.
- A hard per-minute cap bounds raw rows per stream; sampled overflow is dropped and counted. `warn` and above is never dropped.

Because aggregates are complete and raw lines are sampled, a chart or assertion may show 5,000 `info` lines in a minute while the explorer holds only a fraction of them. That is by design: assert on the aggregates, use raw lines to investigate.

## Message patterns

Checkstack groups similar log lines into **patterns** using the Drain algorithm. Before a line is grouped, its variable parts (numbers, hex ids, UUIDs, IP addresses, timestamps, quoted strings, emails, URLs) are masked to a single wildcard token `<*>`, and the remaining tokens form a template. Lines that differ only in those variable parts collapse to one pattern:

```text
User 4821 logged in from 10.0.0.4   ->  User <*> logged in from <*>
User 9330 logged in from 10.2.7.1   ->  User <*> logged in from <*>
```

Both lines map to the template `User <*> logged in from <*>`. Patterns let you see the shape of your logs (a handful of templates instead of millions of lines), count occurrences of a specific message, and notice when a brand-new kind of line appears. Each pattern records its template, a sample line, first and last seen times, an approximate total count, and the worst severity seen for it.

### Defining your own patterns

Mined patterns only exist once a matching line has arrived, but you often want to watch for a message **before** it ever happens - a failure you hope never to see, or a heartbeat you expect from day one. You can define patterns yourself, from two places:

- In the **Patterns** tab, choose "New pattern" and paste a sample line (real or hypothetical). Checkstack masks it for you and shows it as a row of clickable tokens: click the parts that vary between lines to turn them into wildcards, and leave the parts that identify the message as fixed text.
- In the **Explore** tab, expand any log line and choose "Create pattern from this line" to start from something that already happened.

While you build, a live preview counts how many recent lines the pattern would match, so you can see immediately whether it is too broad, too narrow, or (for a not-yet-occurring message) correctly matching nothing yet. If the pattern you define already exists as a mined one, it is promoted to a user pattern rather than duplicated - it keeps its history.

User patterns behave like mined ones everywhere (counters, charts, the explorer, health checks) with one difference: they are yours. They never age out, they match with precedence, and they can be deleted from the Patterns tab - unless a health check still references them, in which case the delete is refused and tells you which checks to update first.

### Patterns your checks depend on are safe

Any pattern referenced by a health check - user-defined or mined - is protected. It is never removed by retention while the reference exists, and it keeps its identity under memory pressure, so a check watching a pattern cannot silently start reading zero because the pattern was cleaned up behind its back.

## Important events

Alongside the raw explorer, each stream has a timeline of **important events** that summarize notable moments without you scrolling through log lines:

- **New pattern**: a never-before-seen `warn`-or-worse template appeared.
- **Spike**: the count of `error` and `fatal` lines in a single minute crossed a threshold (at least 10, and at least 4 times the trailing 30-minute average). Spikes are deduplicated to at most one per stream every 10 minutes.
- **Silence**: the stream received no lines for 15 minutes.
- **Silence recovered**: lines resumed after a silence.

Clicking an event deep-links into the explorer, pre-filtered to the relevant pattern and time.

## Source tokens

A shipper authenticates to a stream with a **source token**, a per-stream secret you mint in the stream's settings. Tokens start with the `ckls_` prefix and are shown in full only once, at mint time. Checkstack stores only a hash and a short display prefix, so a token cannot be recovered later; if you lose it, mint a new one and revoke the old.

A source token authorizes ingest to exactly one stream and nothing else. It is not an application API key and carries no read access. Revoking a token stops it authenticating within about a minute. Anyone who can manage a stream can mint and revoke its tokens, so treat source-token management as sensitive.

## Log health checks

A log stream becomes monitored when you attach a **Log Stream** health check to a system and assert on its metrics. This check probes nothing. On each interval it reads the stream's pre-aggregated buckets over a window and emits one normal health-check run, so the full pipeline (assertions, state thresholds, anomaly detection, incidents, status pages) works exactly as it does for any other check.

The **Window metrics** collector exposes, over a window of complete minutes, numeric assertable fields including `totalCount`, `fatalCount`, `errorCount`, `warnCount`, `infoCount`, `debugCount`, `errorRatePerMinute`, `secondsSinceLastLog`, `newPatternCount`, and `distinctPatternCount`. You build assertions on these the same way you would on any collector, for example:

- `errorCount` greater than or equal to `5` over the window.
- `errorRatePerMinute` greater than `2`.

The **Pattern occurrence** collector counts a single chosen pattern over the window and exposes `occurrenceCount` and `minutesSinceLastSeen`, so you can alert on a specific error template appearing (or on a heartbeat pattern going quiet).

The **Pattern metric** collector goes one step further: it asserts on the **numbers inside** a pattern's lines. Every `<*>` wildcard in a template is a variable, and when the values at a position are numeric, Checkstack aggregates them per minute. Pick a pattern, pick which variable to measure (the picker shows recent sample values for each position), and assert on the window's average, minimum, maximum, or sample count. For example, with the pattern:

```text
Request GET /api/items/<*> completed in <*> ms
```

choose the second variable and assert `maxValue` less than `50` - the check goes unhealthy as soon as any request in the window took 50 ms or longer. Pair value assertions with `sampleCount` greater than `0` when a window without data should not count as passing. This turns ordinary, unstructured log lines into performance metrics without changing how your application logs.

### Absence (a silent stream)

Absence is asserted directly, not configured as a separate mode. The window collector reports `secondsSinceLastLog`, the whole seconds since the stream last received any line. Assert `secondsSinceLastLog` less than `600` to go unhealthy when a stream has been silent for 10 minutes. For a stream that has never received a line, this value counts from when the stream was created, so an absence assertion is meaningful from day one rather than reading as a misleading sentinel.

### Evaluation cadence and the error fast-path

You set the check's **interval** as the evaluation cadence (60 seconds is a good default). The window defaults to that interval and always covers complete minutes, so a partially-filled current minute never skews the metric.

Between scheduled ticks, an **error fast-path** reacts to bursts within seconds. When an ingest flush commits `error` or `fatal` lines, Checkstack enqueues an immediate re-evaluation of the checks that reference the stream, debounced to at most one extra evaluation per assignment every 15 seconds. You get near-real-time reaction to an error surge without running the check more often on quiet streams.

## Retention

Each stream has its own retention policy, editable in its settings. The defaults are:

| Tier | Default retention |
|------|--------------------|
| Raw lines | 3 days |
| Minute-grain aggregates | 48 hours (then rolled up to hourly) |
| Hourly aggregates, patterns, important events | 90 days |

Minute buckets are folded into hourly buckets before they expire, so long-range charts survive even after the minute detail is gone. Raw lines age out on their own shorter schedule, and patterns are forgotten only once all of their aggregates have also aged out.
