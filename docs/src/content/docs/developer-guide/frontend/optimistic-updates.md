---
title: "Optimistic Updates"
description: "When and how to wire `onMutate` / rollback / settle on a TanStack Query mutation so high-frequency toggles feel instant without lying to the user."
---


By default every oRPC `useMutation()` in this codebase auto-invalidates
its owning plugin's queries on success (see
[Query Invalidation](/checkstack/frontend/query-invalidation/) for the
full story). That's the right default — a single round-trip, no stale
data — but on high-frequency cheap toggles it still costs the user a
visible "click → wait → flip" latency.

Optimistic updates close that gap: the cache is patched immediately so
the UI flips on click, with a rollback wired up in case the server
rejects the mutation.

This page documents the canonical pattern. Today (May 2026) it's
applied to exactly two mutations — `markAsRead` on the Notifications
page and `pauseConfiguration` / `resumeConfiguration` on the
Health Check Config page. Broader rollout is a v1.1 task; the pattern
below is the contract any new use must follow.

## When to use it

Optimistic UI is a good fit when **all** of the following hold:

- The mutation is a cheap toggle on local row/item state
  (mark-as-read, pause/resume, star/unstar, vote up/down).
- The mutation has no server-side side effects beyond the asserted
  state change. A pause toggle that also reshuffles ten unrelated
  rows is not a good candidate.
- Rollback is visually obvious. If a failed flip silently undoes a
  user action two seconds later they'll think the click "didn't
  work" — the rollback only feels right when it's plausibly tied to
  the original click.
- The toggled state is local to a single row, not cross-cutting.
  Cascade effects across multiple cached queries multiply the
  rollback surface and quickly outgrow the four-step pattern.

## When NOT to use it

> [!CAUTION]
> Reach for an optimistic update only when you've ruled out every
> case below. Optimistic UI without rollback (or with the wrong
> rollback) is worse than no optimistic UI — it lies to the user.

- **Creates with server-generated IDs.** You don't know the row's
  id until the server replies, so the placeholder row has no stable
  identity, can't be selected, and gets awkward to reconcile.
- **Irreversible mutations.** `delete`, "send notification now",
  "kick user" — anything where the user reasonably expects a
  confirmation moment. Pretending it already happened robs them of
  the chance to bail.
- **Cascade mutations.** Anything that changes state in multiple
  cached queries at once. The four-step pattern below tracks one
  snapshot; cascades need bespoke handling and usually a redesign.
- **Mutations that resolve into a navigation.** The render
  immediately after a successful create/edit usually unmounts the
  caller — there's nothing to optimistically update.

## The canonical four-step cycle

Every optimistic mutation MUST follow these four steps in order:

1. `onMutate` — cancel any in-flight refetch for the affected query,
   snapshot the cache, patch it optimistically, return the snapshot
   as the mutation context.
2. `onError` — restore the snapshot from the returned context.
3. `onSettled` — invalidate the affected query so the cache
   reconciles with server truth (success and error both).
4. Toast voice — suppress success toasts (the UI already flipped),
   keep error toasts (the rollback alone isn't always enough signal).

The exact snippet, using the project's oRPC `useMutation` wrapper
(see [`core/frontend-api/src/orpc-query.tsx`](https://github.com/enyineer/checkstack/blob/main/core/frontend-api/src/orpc-query.tsx)):

```tsx
import {
  usePluginClient,
  useQueryClient,
} from "@checkstack/frontend-api";
import { toastError, useToast } from "@checkstack/ui";
import { NotificationApi } from "@checkstack/notification-common";

const queryClient = useQueryClient();
const toast = useToast();
const notificationClient = usePluginClient(NotificationApi);

// Same query key the loader uses below.
const notificationsKey = [
  ["notification", "getNotifications"],
  { input: { limit: 20, offset: 0, unreadOnly: false }, type: "query" },
] as const;

const markAsRead = notificationClient.markAsRead.useMutation({
  // 1. Cancel + snapshot + patch.
  onMutate: async ({ notificationId }) => {
    await queryClient.cancelQueries({ queryKey: notificationsKey });
    const previous = queryClient.getQueryData<NotificationsPage>(
      notificationsKey,
    );
    if (previous) {
      queryClient.setQueryData<NotificationsPage>(notificationsKey, {
        ...previous,
        notifications: previous.notifications.map((n) =>
          n.id === notificationId ? { ...n, isRead: true } : n,
        ),
      });
    }
    return { previous };
  },
  // 2. Roll back from the snapshot.
  onError: (error, _vars, ctx) => {
    if (ctx?.previous) {
      queryClient.setQueryData(notificationsKey, ctx.previous);
    }
    toastError(toast, "Failed to mark as read", error);
  },
  // 3. Reconcile with server truth either way.
  onSettled: () => {
    void queryClient.invalidateQueries({ queryKey: notificationsKey });
  },
  // 4. No success toast — the UI flip is the feedback.
});
```

### Step-by-step justification

- **`cancelQueries` before snapshotting.** Without this, a refetch
  already in flight when the user clicks can land after the
  optimistic write and silently overwrite it. The cancel makes the
  in-flight refetch a no-op so our patch sticks.
- **Snapshot, then patch.** The snapshot is what `onError` rolls
  back to. Snapshot first so a thrown patch can't leave the cache
  half-modified.
- **Type the `setQueryData` callback.** Read the existing
  `previous` value with the same type the loader uses
  (`queryClient.getQueryData<TLoaderOutput>(key)`). Never reach for
  `any` — narrow with `if (previous)` if the cache miss is possible
  (it usually is on the first interaction).
- **Return `{ previous }` from `onMutate`.** TanStack passes this
  to `onError` as the third arg. Don't stash it in module state.
- **`onSettled` invalidates regardless of outcome.** On success it
  pulls server truth back into the cache so any field the optimistic
  patch didn't touch (timestamps, derived counts) settles correctly.
  On error it pulls server truth back so the just-restored snapshot
  doesn't itself go stale.
- **Suppress success toasts.** The user clicked "mark as read" and
  the row faded — that's the feedback. A toast on top is noise.
- **Keep error toasts.** The rollback alone tells the user "the UI
  is back where it was" but not why. `toastError(toast, "...", err)`
  is the right shape (see [List & Query States](/checkstack/frontend/list-states/)
  for the `toastError` helper).

## The query-key gotcha

The optimistic write, the snapshot, the rollback, and the
`onSettled` invalidation MUST use the **same key** as the query
being patched. The auto-invalidator in
[`core/frontend-api/src/orpc-query.tsx`](https://github.com/enyineer/checkstack/blob/main/core/frontend-api/src/orpc-query.tsx)
matches by prefix (`[[pluginId]]`), but `setQueryData` needs an
**exact** match — it writes one entry, not "every entry under
prefix".

oRPC builds query keys in a fixed shape (see
`generateOperationKey` in `@orpc/tanstack-query`):

```ts
[
  [pluginId, ...procedurePath, procedureName],
  { input?, type? },
]
```

For a top-level procedure like `notification.getNotifications` with
input `{ limit: 20, offset: 0, unreadOnly: false }`, the key is:

```ts
[
  ["notification", "getNotifications"],
  { input: { limit: 20, offset: 0, unreadOnly: false }, type: "query" },
]
```

> [!IMPORTANT]
> If the loader's input changes (e.g. the user paginates or toggles
> a filter), the query key changes too. Either capture the live
> input in the same component as the mutation (so both sides agree)
> or compose the key once via a `useMemo` and share it between the
> `useQuery` call and the mutation.

When the loader uses paging/filter state, build the key from the
same state variables the `useQuery` reads, in the same render. The
two call sites currently using this pattern do exactly that — see
`core/notification-frontend/src/pages/NotificationsPage.tsx` and
`core/healthcheck-frontend/src/pages/HealthCheckConfigPage.tsx`.

## What auto-invalidation still does

The oRPC `useMutation` wrapper still fires its
plugin-wide invalidation on `onSuccess` — that hasn't changed. The
optimistic write is **additive**: it patches the cache before the
network roundtrip starts, and the auto-invalidation pulls server
truth in after the response. On error, our explicit rollback wins
because `onError` runs before any success path.

If you ever override `onSuccess` on an optimistic mutation, remember
that the wrapper composes your handler with its built-in
invalidation — you don't need to invalidate yourself in `onSuccess`,
only in `onSettled` (so the error path also gets reconciled).

## Anti-patterns

- **Skipping `cancelQueries`.** Don't. An in-flight refetch will
  race and silently overwrite the optimistic write — the user sees
  a flip, then a half-second later it un-flips, then flips again.
  Worst of both worlds.
- **Forgetting `onError` rollback.** Optimistic UI without rollback
  is just lying. If the mutation can fail (every mutation can fail),
  rollback is mandatory.
- **Optimistically updating a create / delete.** The pattern only
  works for in-place mutations. For creates, the server-generated
  id is a placeholder hazard; for deletes, the irreversibility is.
- **Spamming success toasts.** The whole point of optimistic UI is
  that the visual change IS the feedback. A toast on top reintroduces
  the latency the pattern was supposed to hide.
- **Stashing the snapshot in module state.** Always return it from
  `onMutate` as the context, and read it from `onError`'s third arg.
  Module state races between concurrent mutations.
- **Using `any` for the snapshot type.** Narrow with
  `queryClient.getQueryData<TLoaderOutput>(key)` and a runtime
  `if (previous)` guard — the cache miss is a real case.
