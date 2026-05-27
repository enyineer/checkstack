---
title: "Query Invalidation"
description: "How mutations, cross-plugin updates, and one-shot editor forms should interact with the oRPC + TanStack Query cache."
---


Frontend data fetching in Checkstack runs on oRPC procedure proxies (per
plugin client, e.g. `healthCheckClient`, `catalogClient`) that wrap
TanStack Query. The `QueryClient` is configured globally in
[`core/frontend/src/App.tsx`](https://github.com/enyineer/checkstack/blob/main/core/frontend/src/App.tsx)
with `staleTime: 30s` and `gcTime: 5min` — i.e. results are served
stale-while-revalidate and cached past unmount.

To keep views fresh without each call site reinventing the wheel, follow
the three pillars below.

## Pillar 1 — Within-plugin mutations: do nothing

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
`onSuccess` handlers, treat them as cleanup candidates — they were
written before automatic invalidation existed.

## Pillar 2 — Cross-plugin mutations: invalidate explicitly

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
`SignalAutoInvalidator` — declare the dependency at the call site.

> [!TIP]
> Prefer invalidating the **whole plugin** (`[[pluginId]]`) rather than
> a single procedure. It costs nothing extra (background refetches are
> cheap, and unmounted queries are just marked stale) and avoids
> brittle assumptions about which view the user happens to be on.

## Pillar 3 — One-shot editors: opt out of stale-while-revalidate

Editors that seed local form state from a query exactly once (e.g. via
`useInitOnceForKey`) are vulnerable to a subtle race:

1. Mutation succeeds → cache is marked stale (Pillar 1).
2. User navigates away. Editor unmounts; cache survives `gcTime`.
3. User reopens the same entity.
4. Query mounts → serves cached **stale** value synchronously while
   refetching in the background.
5. `useInitOnceForKey` fires on render 1 with the stale value, then
   refuses to re-init when the fresh value arrives — keys haven't
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
serve — the loader shows its loading state and `useInitOnceForKey`
fires once with fresh data.

> [!CAUTION]
> Don't reach for `refetchOnMount: "always"`. It still serves the
> cached value synchronously while refetching, so the one-shot init
> still races. `gcTime: 0` is the surgical fix.

The alternative — calling
`queryClient.removeQueries({ queryKey: ... })` inside the mutation's
`onSuccess` — works but couples the mutator to the loader's query key
and has to be repeated for every editor that reads the same data. The
`gcTime: 0` approach localises the contract to the editor itself.
