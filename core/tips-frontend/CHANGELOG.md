# @checkstack/tips-frontend

## 0.2.2

### Patch Changes

- Updated dependencies [b627562]
  - @checkstack/ui@1.8.2
  - @checkstack/auth-frontend@0.6.2

## 0.2.1

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/auth-frontend@0.6.1
  - @checkstack/frontend-api@0.5.1
  - @checkstack/tips-common@0.2.1
  - @checkstack/ui@1.8.1

## 0.2.0

### Minor Changes

- 3547670: Redesign `<Tip>` to be user-triggered instead of auto-opening.

  A small lightbulb icon is now rendered immediately after the wrapped
  element. The popover only opens when the user clicks the lightbulb.
  Once the user explicitly dismisses the tip (X, "Got it", or the action
  button), the lightbulb disappears for that user (per-user when signed
  in, per-browser when anonymous) and only the underlying element is
  rendered.

  This replaces the previous auto-open behaviour, which was racing with
  focus management whenever multiple tips on a page mounted at once
  (e.g. the Catalog "Add System" + "Add Group" tips would flash open and
  instantly self-close as Radix's outside-focus handler fired). It also
  fixes the bug where clicking the anchored button would silently dismiss
  the tip — the lightbulb model has no implicit dismissal at all.

  The default `align` for the popover changed from `"start"` to `"end"`
  so the popover hangs off the lightbulb rather than the larger anchor
  to its left. New optional `triggerClassName` prop on `<TipProps>` lets
  callers restyle the lightbulb when needed.

- 3547670: Add `@checkstack/tips-*` — first-run tip and onboarding infrastructure for
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

### Patch Changes

- Updated dependencies [42abfff]
- Updated dependencies [3547670]
- Updated dependencies [1ef2e79]
- Updated dependencies [aa89bc5]
- Updated dependencies [950d6ec]
- Updated dependencies [3547670]
  - @checkstack/common@0.9.0
  - @checkstack/ui@1.8.0
  - @checkstack/frontend-api@0.5.0
  - @checkstack/auth-frontend@0.6.0
  - @checkstack/tips-common@0.2.0
