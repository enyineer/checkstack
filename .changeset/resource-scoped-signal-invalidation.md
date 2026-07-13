---
"@checkstack/signal-common": minor
"@checkstack/frontend-api": minor
"@checkstack/frontend": minor
"@checkstack/logstream-common": minor
"@checkstack/logstream-frontend": minor
---

Add per-resource scoping to realtime signal auto-invalidation. Signals may now
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
