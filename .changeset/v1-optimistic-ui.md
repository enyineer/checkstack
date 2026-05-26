---
"@checkstack/frontend-api": patch
"@checkstack/healthcheck-frontend": patch
"@checkstack/notification-frontend": patch
---

Establish the canonical optimistic-UI pattern for oRPC mutations
(`onMutate` snapshot / patch, `onError` rollback, `onSettled`
invalidate) and apply it to the two highest-frequency toggles where
perceived latency was most visible:

- `markAsRead` on the Notifications page — clicking the check on a
  notification card now flips the read state immediately instead of
  waiting for the round-trip.
- `pauseConfiguration` / `resumeConfiguration` on the Health Check
  Config page — pause/resume now flip the row's badge instantly,
  rolling back on server error.

The wrapper type for `useMutation` on each plugin client gained an
optional `TContext` generic so optimistic sites can return a snapshot
from `onMutate` and consume it in `onError` without `unknown` casts.
The runtime behaviour and the auto-invalidation on success are
unchanged; the change is additive on the type surface only.

Full pattern and "when NOT to use it" guidance live in
`docs/frontend/optimistic-updates.md`.
