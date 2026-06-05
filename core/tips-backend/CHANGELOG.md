# @checkstack/tips-backend

## 0.3.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/backend-api@0.21.1
  - @checkstack/auth-backend@0.5.1
  - @checkstack/tips-common@0.3.1

## 0.3.0

### Minor Changes

- 9dcc848: Align workspace dependency versions and migrate React Router to v7.

  BREAKING CHANGES (React Router v7): All frontend packages now depend on `react-router-dom@^7.16.0`. Previously the workspace declared four divergent ranges (`^6.20.0`, `^6.22.0`, `^7.1.1`, `^7.14.2`), which resolved both `react-router@6` and `react-router@7` into a single bundle. Everything is now unified on v7. The public imports the app uses (`BrowserRouter`, `Routes`, `Route`, `Link`, `NavLink`, `MemoryRouter`, `useNavigate`, `useParams`, `useSearchParams`, `useLocation`) are unchanged between v6 and v7, so no source rewrites were required - but any out-of-tree plugin still on react-router v6 should upgrade to v7 (see the React Router v6 -> v7 upgrade guide) to share the host's single router instance via the import map.

  Other unified ranges (no API change): `react` -> `^18.3.1`, the `@orpc/*` family (`contract`, `server`, `client`, `tanstack-query`, `openapi`, `zod`) -> `^1.14.4`, and `better-auth` -> `^1.6.13`.

  Removed the pre-rename `@orpc/react-query` leftover from `@checkstack/frontend-api`; its `createRouterUtils` / `RouterUtils` / `ProcedureUtils` now come from `@orpc/tanstack-query` (the package already in use).

  Stale in-range runtime deps pulled up to current published versions: `hono` `^4.12.23`, `@tanstack/react-query` (+devtools) `^5.100.14`, `date-fns` `^4.4.0`, `jose` `^6.2.3`, `tar` `^7.5.16`, `semver` `^7.8.1`, `@xyflow/react` `^12.11.0`.

### Patch Changes

- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
  - @checkstack/auth-backend@0.5.0
  - @checkstack/backend-api@0.21.0
  - @checkstack/common@0.13.0
  - @checkstack/tips-common@0.3.0

## 0.2.8

### Patch Changes

- Updated dependencies [a57f7db]
  - @checkstack/backend-api@0.20.0
  - @checkstack/auth-backend@0.4.33

## 0.2.7

### Patch Changes

- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
  - @checkstack/backend-api@0.19.0
  - @checkstack/auth-backend@0.4.32

## 0.2.6

### Patch Changes

- Updated dependencies [6d52276]
- Updated dependencies [35bc682]
  - @checkstack/common@0.12.0
  - @checkstack/backend-api@0.18.0
  - @checkstack/auth-backend@0.4.31
  - @checkstack/tips-common@0.2.3

## 0.2.5

### Patch Changes

- @checkstack/backend-api@0.17.1
- @checkstack/auth-backend@0.4.30

## 0.2.4

### Patch Changes

- f23f3c9: Add `correlationMiddleware` to `@checkstack/backend-api` and apply it
  to every plugin/core router so each request carries a stable
  `x-correlation-id` (read from the inbound header, or freshly minted
  via `crypto.randomUUID()` when absent) and an auto-injected child
  logger bound with `{ correlationId, pluginId, userId? }`. The ID is
  echoed back on the response header so the caller can correlate their
  client-side trace to the server logs.

  The `Logger` interface in `@checkstack/backend-api` now formally
  documents the structured-metadata convention (`logger.info("msg",
{ ...meta })`) alongside the long-standing varargs shape. Winston's
  splat handling already routes both shapes through the same vararg
  slot, so existing call sites are unaffected. A new optional
  `Logger.child(meta)` method captures the metadata-binding contract the
  new middleware relies on; production loggers always implement it,
  minimal test mocks may omit it (the middleware falls back gracefully).

  `RpcContext` grew two optional `Headers` bags, `requestHeaders` and
  `responseHeaders`, populated by the outer Hono `/api/*` and `/rest/*`
  handlers in `@checkstack/backend`. They are write-through observation
  points for middleware; an `RpcContext` constructed without them (S2S
  clients, tests) keeps working — the echo is a silent no-op and the ID
  is still bound onto the child logger for server-side correlation.

  The scaffolding template in `@checkstack/scripts` was updated so any
  new plugin generated via `bun run create` wires the middleware in the
  expected `.use(correlationMiddleware).use(autoAuthMiddleware)` order
  out of the box.

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/backend-api@0.17.0
  - @checkstack/auth-backend@0.4.29
  - @checkstack/tips-common@0.2.2

## 0.2.3

### Patch Changes

- Updated dependencies [a06b899]
- Updated dependencies [a06b899]
  - @checkstack/backend-api@0.16.0
  - @checkstack/auth-backend@0.4.28

## 0.2.2

### Patch Changes

- b33fb4d: Refresh `bun.lock` to clear MEDIUM-severity Trivy advisories on transitive
  runtime dependencies. No public API change — bumping every workspace
  package that lists `@orpc/server` as a direct dep so consumers re-resolve
  the optional `ws` peer to the patched release on their next install.

  - `ws` `8.20.0` → `8.20.1` (CVE-2026-45736). Pulled into the install tree
    as `@orpc/server`'s optional WebSocket peer; Bun auto-installs it into
    every backend package that depends on `@orpc/server`, so a stale 8.20.0
    ships in the consumer's `node_modules` until the parent package
    re-resolves.
  - `brace-expansion` `5.0.5` → `5.0.6` (CVE-2026-45149). Pulled in only
    through dev tooling (`minimatch@10` via `@typescript-eslint` and
    `storybook`'s `glob@13`), so it does not ship to consumers and no
    workspace `package.json` lists it; the lockfile bump alone clears the
    finding for the Docker image and the local dev tree. No version bump
    is attributed to this advisory.

  The fix lives entirely in `bun.lock` — no `package.json`, `overrides`, or
  `resolutions` change is needed because both parent ranges (`minimatch@10
→ brace-expansion@^5.0.5`, `@orpc/server / storybook / happy-dom →
ws@>=8.18.x`) already accept the patched releases, and `bun install`
  keeps the resolved versions sticky after the initial `bun update`.

- Updated dependencies [1909a61]
- Updated dependencies [b33fb4d]
  - @checkstack/backend-api@0.15.3
  - @checkstack/auth-backend@0.4.27

## 0.2.1

### Patch Changes

- Updated dependencies [9016526]
- Updated dependencies [080627f]
  - @checkstack/common@0.10.0
  - @checkstack/auth-backend@0.4.26
  - @checkstack/backend-api@0.15.2
  - @checkstack/tips-common@0.2.1

## 0.2.0

### Minor Changes

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
  - @checkstack/common@0.9.0
  - @checkstack/tips-common@0.2.0
  - @checkstack/auth-backend@0.4.25
  - @checkstack/backend-api@0.15.1
