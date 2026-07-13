---
title: "Query Invalidation"
description: "How mutations, cross-plugin updates, and one-shot editor forms should interact with the oRPC + TanStack Query cache."
---


Frontend data fetching in Checkstack runs on oRPC procedure proxies (per
plugin client, e.g. `healthCheckClient`, `catalogClient`) that wrap
TanStack Query. The `QueryClient` is configured globally in
[`core/frontend/src/App.tsx`](https://github.com/enyineer/checkstack/blob/main/core/frontend/src/App.tsx)
with `staleTime: 30s` and `gcTime: 5min` - i.e. results are served
stale-while-revalidate and cached past unmount.

To keep views fresh without each call site reinventing the wheel, follow
the three pillars below.

## Pillar 1 - Within-plugin mutations: do nothing

Every `useMutation()` produced by an oRPC plugin client already runs

```ts
queryClient.invalidateQueries({ queryKey: [[pluginId]] });
```

on success (see
[`core/frontend-api/src/orpc-query.tsx`](https://github.com/enyineer/checkstack/blob/main/core/frontend-api/src/orpc-query.tsx)).
That marks **every** query for that plugin stale and triggers a refetch
for any active observer.

> [!NOTE]
> Do **not** add `refetchX()` or `queryClient.invalidateQueries(...)`
> calls in `onSuccess` for queries owned by the same plugin as the
> mutation. They're redundant and they obscure which calls are actually
> load-bearing.

If you spot legacy `refetch()` calls inside same-plugin mutation
`onSuccess` handlers, treat them as cleanup candidates - they were
written before automatic invalidation existed.

## Pillar 2 - Cross-plugin mutations: invalidate explicitly

The auto-invalidator only knows about the **owning** plugin. If a
mutation in plugin A changes data that plugin B displays, you must
invalidate B yourself:

```ts
const queryClient = useQueryClient();

const subscribe = notificationClient.subscribe.useMutation({
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: [["healthcheck"]] });
  },
});
```

This mirrors the realtime `foreignSignals` mechanism used by
`SignalAutoInvalidator` - declare the dependency at the call site.

> [!TIP]
> Prefer invalidating the **whole plugin** (`[[pluginId]]`) rather than
> a single procedure. It costs nothing extra (background refetches are
> cheap, and unmounted queries are just marked stale) and avoids
> brittle assumptions about which view the user happens to be on.

## Pillar 3 - One-shot editors: opt out of stale-while-revalidate

Editors that seed local form state from a query exactly once (e.g. via
`useInitOnceForKey`) are vulnerable to a subtle race:

1. Mutation succeeds → cache is marked stale (Pillar 1).
2. User navigates away. Editor unmounts; cache survives `gcTime`.
3. User reopens the same entity.
4. Query mounts → serves cached **stale** value synchronously while
   refetching in the background.
5. `useInitOnceForKey` fires on render 1 with the stale value, then
   refuses to re-init when the fresh value arrives - keys haven't
   changed.

Result: the form is seeded from pre-mutation data. Symptom: deleted
items reappear, edits look reverted, etc. A hard refresh "fixes" it by
dropping the cache entirely.

**Rule:** for any query whose result drives a one-shot local-state
init, disable cross-mount caching:

```ts
const { data: existingConfig } =
  healthCheckClient.getConfiguration.useQuery(
    { id: configId ?? "" },
    {
      enabled: isEditMode,
      // Editor seeds form state once via useInitOnceForKey; serving a
      // stale cached value on remount would race the one-shot init.
      gcTime: 0,
    },
  );
```

`gcTime: 0` drops the cached entry as soon as the query has no
observers (i.e. on unmount), so the next mount has no stale value to
serve - the loader shows its loading state and `useInitOnceForKey`
fires once with fresh data.

> [!CAUTION]
> Don't reach for `refetchOnMount: "always"`. It still serves the
> cached value synchronously while refetching, so the one-shot init
> still races. `gcTime: 0` is the surgical fix.

The alternative - calling
`queryClient.removeQueries({ queryKey: ... })` inside the mutation's
`onSuccess` - works but couples the mutator to the loader's query key
and has to be repeated for every editor that reads the same data. The
`gcTime: 0` approach localises the contract to the editor itself.

## Pillar 4 - Realtime signals: scope to a resource when a signal is high-frequency

Pillars 1 to 3 cover mutation-driven invalidation. Realtime signals are a
second invalidation source:
[`SignalAutoInvalidator`](https://github.com/enyineer/checkstack/blob/main/core/frontend/src/components/SignalAutoInvalidator.tsx)
subscribes to every incoming signal and, by default, invalidates the whole
owning plugin's cache (`[[pluginId]]`) - the realtime analogue of Pillar 1.
For most signals that is exactly right and needs no wiring.

It becomes a problem when a signal is BOTH high-frequency AND per-resource. A
log stream broadcasts an activity signal every couple of seconds per active
stream; with blanket invalidation, a user watching stream A's detail page
refetches every logstream query - including the list page's heavy grouped
summaries - each time ANY stream ingests. TanStack refetches active queries on
invalidation regardless of `staleTime`, so a larger `staleTime` does not help.

### Declare a `resourceKey` on the signal

A signal can carry an optional `resourceKey` extractor. When present and it
yields an id from the payload, the auto-invalidator narrows invalidation from
the whole plugin to only the queries that concern that resource.

```ts
export const LOGSTREAM_ACTIVITY = createSignal({
  pluginMetadata,
  event: "activity",
  payloadSchema: z.object({ streamId: z.string(), linesDelta: z.number() }),
  // Scope invalidation to the ingesting stream.
  resourceKey: (payload) => payload.streamId,
});
```

A signal WITHOUT a `resourceKey` keeps the blanket-plugin behavior unchanged,
so adding one to a single signal never affects any other signal. Register the
plugin's resource-scoped signals on its frontend plugin config so the
invalidator can recover the extractor from a received signal's id:

```ts
export default createFrontendPlugin({
  metadata: pluginMetadata,
  signals: [LOGSTREAM_ACTIVITY, LOGSTREAM_IMPORTANT_EVENT],
  // ...
});
```

### How a query is matched

For a resource-scoped signal, a query under `[[pluginId]]` is invalidated when
EITHER:

- its query key contains the resource id - detail queries whose input carries
  the id (e.g. `getStreamOverview({ streamId })`) match automatically, with no
  extra wiring, and only for their own resource; OR
- it opted in with `meta: { signalScope: "plugin" }` - for resource-agnostic
  queries that must refresh on ANY resource's activity.

The id is matched as a substring of TanStack's serialized query hash. Resource
ids are UUIDs, so an accidental collision is negligible, and a false positive
would only cause one extra harmless refetch - never a missed one. The bias is
deliberate: over-invalidation is safe, under-invalidation is the only real bug.

### Opt resource-agnostic list queries back in

A list or summary query spans all resources and cannot match a single id, so
it must opt into whole-plugin refresh with the ready-made `signalScopeMeta`:

```ts
import { signalScopeMeta } from "@checkstack/signal-common";

// Refreshes on ANY stream's activity - it shows per-row activity for all.
const { data } = client.listStreamSummaries.useQuery({}, { meta: signalScopeMeta });
```

> [!IMPORTANT]
> Only add `signalScopeMeta` to a query that genuinely needs to refresh on any
> resource's activity (list/summary/aggregate queries). A detail query whose
> input already contains the resource id must NOT opt in - it already matches
> its own resource, and opting in would drag it back to refetching on every
> resource's signal, defeating the scoping.

### Coalescing is per resource

Invalidations are still coalesced through a 300ms trailing debounce, but the
coalesce bucket is now keyed on `pluginId` + `resourceId`. A burst for stream A
and a burst for stream B stay in independent buckets - they neither collapse
into each other nor degrade into a blanket invalidation.

### Foreign signals stay blanket

The cross-plugin `foreignSignals` opt-in (Pillar 2's realtime analogue) is
always blanket: a foreign subscriber opts into a plugin's reactivity wholesale
and its own queries are not keyed on the originating plugin's resource ids.
Resource scoping applies only to the signal's OWNING plugin.
