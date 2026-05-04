---
"@checkstack/tips-common": minor
"@checkstack/tips-backend": minor
"@checkstack/tips-frontend": minor
"@checkstack/ui": minor
"@checkstack/test-utils-backend": patch
---

Add `@checkstack/tips-*` — first-run tip and onboarding infrastructure for
the frontends.

Three new packages:

- `@checkstack/tips-common` — RPC contract (`tipsContract`), `TipsApi`
  client definition, and zod schemas. Fully-qualified tip IDs have shape
  `<pluginId>.<localTipId>` and are produced exclusively by
  `qualifyTipId(plugin, localId)` — plugins never write the namespace
  themselves, and a local id with a leading or trailing `.` is rejected,
  so one plugin cannot forge or dismiss a tip in another plugin's
  namespace.
- `@checkstack/tips-backend` — Postgres-backed dismissal store
  (`user_tip_dismissal` with composite PK on `(user_id, tip_id)`),
  `listDismissed` / `dismiss` / `reset` endpoints scoped to the
  requesting user via the auto-auth middleware, and a
  `auth.userDeleted` hook that cleans up dismissals when a user is
  deleted.
- `@checkstack/tips-frontend` — `<Tip>` (anchored popover) and
  `<TipBanner>` (inline callout) components plus the `useTipState`
  hook. All three accept `{ plugin, id }` (where `plugin` is the
  caller's `pluginMetadata`) and route through `qualifyTipId` so the
  namespace prefix is enforced at the boundary. Persists per-user on
  the server when logged in, and per-browser in `localStorage`
  (`checkstack.tips.dismissed`) when anonymous, with cross-tab sync via
  the `storage` event.

`@checkstack/ui`'s `<EmptyState>` gains optional `steps` and `actions`
props for richer empty-state coaching (numbered onboarding lists +
primary CTA), and accepts `ReactNode` for `description`. Existing
callers continue to work unchanged.

`@checkstack/test-utils-backend`'s `createMockDb` now also mocks
`insert().values().onConflictDoNothing()` so routers using upsert-or-skip
semantics can be unit-tested.
