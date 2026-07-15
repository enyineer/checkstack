---
title: Stream to system links
description: How log, metric, and trace streams link to catalog systems - the shared contract, the readable-guard, service-name suggestions, and the catalog surfaces they light up.
---

Observability streams and catalog systems are connected through EXPLICIT
links: a stream manager picks the systems a stream belongs to, and the
catalog's system page and the dashboard light up from those links. Links
are never inferred - the UI SUGGESTS candidates from observed
`service.name` values, and a human applies each one.

## The shared contract

All three stream plugins (logstream, metricstream, tracestream) declare the
same four procedures over their own junction table; the input/output
schemas live once in `@checkstack/telemetry-common` (`system-links.ts`) so
the contracts cannot drift:

```ts
listSystemLinks({ streamId })            // -> { systemIds }
setSystemLinks({ streamId, systemIds })  // replace-all, max 200
listStreamsForSystem({ systemId })       // -> { streams: [{ id, name }] }
listLinkedStreamStatuses({ systemIds })  // -> { matches: [...] } (bulk)
```

- `listSystemLinks` / `setSystemLinks` are scoped by the STREAM
  (`instanceAccess: { idParam: "streamId" }`, read/manage).
- The write additionally verifies the caller can READ every NEWLY ADDED
  system (the diff against the persisted set), using a USER-scoped catalog
  client (the handler re-enters the router as the caller, one `getSystems`
  membership pass) BEFORE anything persists - a stream manager cannot
  expose a system they cannot see. Retained and removed links need no
  readability, so a manager is never dead-locked by a link a
  broader-privileged user authorized earlier.
- The two reverse lookups are post-filtered to the caller's readable
  streams (`listKey`), so the system page and dashboard only ever reveal
  streams the viewer may read.

Storage is a per-plugin junction table with a bare-text `systemId` (no
foreign key into the catalog - the same convention as `incident_systems`
and `system_health_checks`).

## The link editor and suggestions

The shared editor is `StreamSystemLinksEditor` from
`@checkstack/catalog-frontend`: a controlled system picker plus a
"Suggested from observed service names" affordance. Each stream plugin
embeds it in its Settings tab and supplies its own suggestion source:

- tracestream: `listServices({ streamId })` (the service catalog).
- metricstream: label values of `service.name` / `service_name`, sampled
  from the highest-cardinality metric.
- logstream: `listServiceNames({ streamId })` - a bounded scan of the
  newest stored events' `resource` attributes (a suggestion source, not an
  exhaustive catalog).

Suggestions that match a readable catalog system render as chips the
operator explicitly clicks to add; nothing is ever auto-applied.

## Catalog surfaces

- **System detail page**: each stream plugin fills `SystemDetailsSlot`
  with a compact card (Logs / Metrics / Traces) listing the system's
  linked streams; the card self-hides when the system has none.
- **Dashboard signals**: each plugin fills `SystemSignalsSlot` with a
  headless bulk filler backed by `listLinkedStreamStatuses` - one query
  for all visible systems. The mapping is deliberately conservative
  (e.g. a recent log/trace error spike -> an "error" signal; anything
  ambiguous is skipped) so the "needs attention" view stays signal, not
  noise.

> [!NOTE]
> Health-check ASSIGNMENTS remain the mechanism for "this check probes
> this system". Stream links are about observability data ownership -
> which system's logs/metrics/traces these are - and power navigation,
> signals, and (later) AI context, not health state.
