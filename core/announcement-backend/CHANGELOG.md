# @checkstack/announcement-backend

## 0.6.6

### Patch Changes

- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
  - @checkstack/auth-backend@0.12.0
  - @checkstack/backend-api@0.34.0
  - @checkstack/common@0.23.0
  - @checkstack/status-page-backend@0.6.5
  - @checkstack/command-backend@0.2.26
  - @checkstack/announcement-common@0.7.2
  - @checkstack/cache-api@0.3.20
  - @checkstack/signal-common@0.3.1
  - @checkstack/cache-utils@0.3.1

## 0.6.5

### Patch Changes

- @checkstack/announcement-common@0.7.1
- @checkstack/auth-backend@0.11.2
- @checkstack/backend-api@0.33.0
- @checkstack/cache-api@0.3.19
- @checkstack/cache-utils@0.3.0
- @checkstack/command-backend@0.2.25
- @checkstack/common@0.22.0
- @checkstack/signal-common@0.3.0
- @checkstack/status-page-backend@0.6.4

## 0.6.4

### Patch Changes

- @checkstack/status-page-backend@0.6.3

## 0.6.3

### Patch Changes

- Updated dependencies [4568dcc]
- Updated dependencies [d00e099]
  - @checkstack/signal-common@0.3.0
  - @checkstack/backend-api@0.33.0
  - @checkstack/announcement-common@0.7.1
  - @checkstack/auth-backend@0.11.2
  - @checkstack/cache-api@0.3.19
  - @checkstack/cache-utils@0.3.0
  - @checkstack/command-backend@0.2.25
  - @checkstack/common@0.22.0
  - @checkstack/status-page-backend@0.6.2

## 0.6.2

### Patch Changes

- @checkstack/backend-api@0.32.1
- @checkstack/status-page-backend@0.6.1
- @checkstack/auth-backend@0.11.1
- @checkstack/command-backend@0.2.24

## 0.6.1

### Patch Changes

- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
  - @checkstack/backend-api@0.32.0
  - @checkstack/auth-backend@0.11.0
  - @checkstack/cache-utils@0.3.0
  - @checkstack/status-page-backend@0.6.0
  - @checkstack/command-backend@0.2.23

## 0.6.0

### Minor Changes

- 43e4484: Status page enhancements:

  - Group-status widget can collapse its member rows while every member is
    operational (auto-expanding on any issue or maintenance).
  - New "Announcements" status-page widget, contributed fully externally by the
    announcement plugin: it surfaces active `visibility: "all"` announcements
    through a public-safe DTO (title/message/severity/timestamps only) and never
    affects the page status rollup.
  - Incident and maintenance widgets can scope by catalog GROUPS with per-system
    exceptions. Scope is resolved at read time (`(systemIds ∪ members(groupIds)) −
excludedSystemIds`), so members added to a group later are reflected
    automatically. The builder gets a nested group/system picker.
  - Incident and maintenance items on a public page link to dedicated public
    detail pages, gated server-side to items the page's published widgets actually
    surface (no enumeration, no internal-field leak). The custom-domain public
    bundle gains a minimal in-memory router for the two detail pages.
  - Fix the custom-domain "Cannot connect to Checkstack backend" screen: a
    configured-but-not-servable custom domain now serves the lean public
    "not available" page instead of the admin shell; the public bundle skips the
    cross-origin `/api/config` probe; CORS admits resolved custom domains; the
    request origin is normalized for proxy scheme/port variance; and re-saving an
    unchanged custom domain no longer clears its verification.
  - Anonymous email subscriptions (double opt-in) for incident updates, opt-in per
    status page (`emailSubscriptionsEnabled`, default off): a new
    `status_page_subscribers` table, public subscribe/verify/unsubscribe
    procedures with constant-time responses that fail closed when the page has not
    enabled subscriptions, and team-scoped admin list/remove + an enable toggle in
    the builder. Emails are delivered through a new `sendRawEmail` primitive in
    notification-backend that sends to an arbitrary external address (no auth
    account) via every enabled email strategy (SMTP), with a mandatory unsubscribe
    link.
  - Incident/maintenance update fan-out to subscribers via a new
    `notificationAudienceExtensionPoint` in notification-backend. Every
    notification funnelled through `notifyForSubscription` (incident, maintenance,
    health - all unchanged) now also invokes each registered audience sink exactly
    once, enriched with the affected systems and their catalog groups (resolved
    from notification-backend's own resource-parent graph, never a domain import).
    status-page-backend contributes a sink that, AT SEND TIME, matches each
    notification's affected systems against the systems each published + public +
    email-enabled page currently surfaces in its incident/maintenance widgets
    (honoring group membership and per-system exclusions) and emails that page's
    verified subscribers. Send-time scoping against the live layout is the privacy
    boundary: a page only ever emails about systems its widgets surface right now.
    Because `notifyForSubscription` is a single-pod point RPC, each notification
    fans out exactly once cluster-wide.
  - Subscriber reconcile on page deletion: the subscriber FK is `ON DELETE
CASCADE` and page deletion also explicitly purges subscribers (invalidating
    pending verify/unsubscribe tokens) - no orphan rows, no post-deletion send.
    Removing all systems from a page or disabling email is intentionally NOT a
    prune: send-time scoping plus the email-enabled gate make those subscribers
    dormant with no data loss, and re-enabling restores the audience without a
    re-subscribe.
  - Send-time scoping is single-source: the fan-out asks each event-feed widget for
    its CURRENT effective system scope (the same live catalog group expansion the
    widget renders from) instead of a parallel copy of group membership, so it can
    never over- or under-deliver relative to what the page shows.
  - `sendRawEmail` in notification-backend is now `userType: "service"` (was an
    authenticated procedure gated on `notification.send`). Sending to an arbitrary
    address is an open-relay / email-bomb primitive, so it is callable only by a
    trusted backend-to-backend caller (the status-page subscriber mailer), never by
    an end user.
  - Incident/maintenance widgets gain an optional per-system PUBLIC label override
    (`systemLabels`), the same override path the system-health widget uses, so the
    public incident/maintenance detail pages present clean labels instead of raw
    catalog names.
  - The anonymous subscribe endpoint adds a coarse per-page quota (max new
    subscribers per rolling hour, counted over durable rows so it holds across
    pods) on top of the per-(page,email) cooldown, capping verification-email
    amplification. The quota is CONFIGURABLE per status page (new nullable
    `email_subscribers_hourly_quota` column; null uses the default of 50, so
    existing pages are unchanged), validated as a positive integer up to 5000,
    editable in the builder next to the email opt-in toggle and gated by the same
    page-manage capability.
  - Email verification is now per-page configurable and backed by a platform-global
    once-per-address registry:
    - New `email_verification_required` column (boolean, default true) on
      `status_pages`, exposed on the admin StatusPage DTO + `updateStatusPage`
      input (same page-manage gate) with a builder toggle. When OFF, a new
      subscriber is created active immediately - no verification email, and the
      address is NOT written to the global registry (the operator's trust choice
      for e.g. an internal page).
    - New `status_page_verified_emails` table: one row per normalized address that
      has completed verification on ANY page. When a verification-required page is
      subscribed by an already-globally-verified address, the row is created active
      immediately and a COURTESY email (with one-click unsubscribe) is sent instead
      of a verification email, so a malicious add is always caught. `verify` upserts
      the address into this registry and activates every other pending row for the
      same address in one update (confirm once, all pages).
    - Fan-out is unchanged: it still gates on the per-row `verified` flag; the
      registry only governs whether a NEW subscribe short-circuits to active.

  BREAKING CHANGE: `sendRawEmail` is now service-only. Any (non-existent in-tree)
  authenticated caller must invoke it through a trusted service client instead.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.

### Patch Changes

- 43e4484: Batch hot-path scoped-db reads/writes into single transactions to cut per-query round-trips.

  The scoped-db proxy wraps every standalone query in its own `BEGIN → SET LOCAL search_path → query → COMMIT`, so a path issuing N sequential queries paid N round-trips and checked out a connection N times. These reads/writes now run under one `withScopedTransaction`, collapsing the batch to a single `SET LOCAL` on one connection. Behavior is unchanged:

  - healthcheck: `getSystemHealthOverview`'s `1 + N·(2+E)` read fan-out.
  - incident/maintenance: `getIncident`/`getMaintenance` (4 reads), `getManyEntityStates`, `listOpenIncidentsBySystem` / `getActiveMaintenancesBySystem`, `getMaintenanceWindowsForRange`; the `list*` / `*ForSystem` per-row `N+1` system lookups collapsed to a single set-based `inArray` read; maintenance `transitionStatus` update+insert made atomic; `addUpdate`/`editUpdate`/`addLink` use `.returning()` instead of a follow-up re-select.
  - ai: `appendMessage`, memory `saveOrUpdate`.
  - notification: `resolveInheritedGroups`.
  - status-page: subscriber `verify` (4 reads) and `unsubscribe` (3 reads).
  - announcement: `getActiveAnnouncements` / `dismissAnnouncement` / `createAnnouncement`.
  - gitops: `upsertProvenance`.

- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
  - @checkstack/auth-backend@0.10.1
  - @checkstack/backend-api@0.31.1
  - @checkstack/status-page-backend@0.5.0
  - @checkstack/announcement-common@0.7.0
  - @checkstack/command-backend@0.2.22

## 0.5.6

### Patch Changes

- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [d0eddc9]
- Updated dependencies [d0eddc9]
- Updated dependencies [d0eddc9]
- Updated dependencies [f93ee7a]
  - @checkstack/common@0.22.0
  - @checkstack/backend-api@0.31.0
  - @checkstack/auth-backend@0.10.0
  - @checkstack/announcement-common@0.6.3
  - @checkstack/cache-api@0.3.19
  - @checkstack/command-backend@0.2.21
  - @checkstack/signal-common@0.2.17
  - @checkstack/cache-utils@0.2.24

## 0.5.5

### Patch Changes

- Updated dependencies [390d9cf]
  - @checkstack/backend-api@0.30.0
  - @checkstack/auth-backend@0.9.5
  - @checkstack/command-backend@0.2.20

## 0.5.4

### Patch Changes

- Updated dependencies [c55d7c6]
  - @checkstack/common@0.21.0
  - @checkstack/backend-api@0.29.1
  - @checkstack/announcement-common@0.6.2
  - @checkstack/auth-backend@0.9.4
  - @checkstack/cache-api@0.3.18
  - @checkstack/command-backend@0.2.19
  - @checkstack/signal-common@0.2.16
  - @checkstack/cache-utils@0.2.23

## 0.5.3

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/backend-api@0.29.0
  - @checkstack/common@0.20.0
  - @checkstack/auth-backend@0.9.3
  - @checkstack/command-backend@0.2.18
  - @checkstack/announcement-common@0.6.1
  - @checkstack/cache-api@0.3.17
  - @checkstack/signal-common@0.2.15
  - @checkstack/cache-utils@0.2.22

## 0.5.2

### Patch Changes

- Updated dependencies [e819276]
  - @checkstack/backend-api@0.28.0
  - @checkstack/auth-backend@0.9.2
  - @checkstack/command-backend@0.2.17

## 0.5.1

### Patch Changes

- @checkstack/backend-api@0.27.1
- @checkstack/auth-backend@0.9.1
- @checkstack/command-backend@0.2.16

## 0.5.0

### Minor Changes

- a7f7e98: Announcements now have a stable, operator-controlled display order.

  ## What changed

  - **Stable ordering (bugfix).** `getActiveAnnouncements` had no `ORDER BY`, so
    Postgres returned rows in heap order, which shifts after any `UPDATE` - that
    is why announcements jumped position whenever one was edited. Both
    `getActiveAnnouncements` and `listAllAnnouncements` now order by
    `sort_order`, with `created_at` and `id` as stable tiebreakers, so the
    sequence never changes on its own.
  - **Manual sorting.** `announcements` gained a `sort_order` integer column
    (migration `0001`, back-filled from existing creation order). A new
    `reorderAnnouncements` admin procedure takes the full ordered id list and
    writes each announcement's position in one atomic `UPDATE ... CASE`. Operators
    reorder from the management page with per-row up/down arrows (desktop table
    and mobile cards). New announcements append at the end; editing an
    announcement never moves it.
  - **Pure manual order everywhere.** The public banner no longer force-sorts by
    severity - banner, dashboard, and admin list all render the operator's order.
  - The `announcement.updated` signal payload's `action` gained a `"reordered"`
    value so listeners refetch after a reorder.

  ## Notes

  - `sort_order` is backend-internal; it is not exposed on the public
    `Announcement` schema (the frontend derives order from query order).
  - Migration `0001_typical_omega_red.sql` adds the column (default `0`) and
    back-fills distinct values via `row_number()` over `created_at, id`. It
    applies cleanly to both fresh and already-populated databases.

### Patch Changes

- Updated dependencies [0d912a3]
- Updated dependencies [a7f7e98]
- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [0d912a3]
  - @checkstack/auth-backend@0.9.0
  - @checkstack/announcement-common@0.6.0
  - @checkstack/common@0.19.0
  - @checkstack/backend-api@0.27.0
  - @checkstack/cache-api@0.3.16
  - @checkstack/cache-utils@0.2.21
  - @checkstack/command-backend@0.2.15
  - @checkstack/signal-common@0.2.14

## 0.4.14

### Patch Changes

- Updated dependencies [defb97b]
  - @checkstack/common@0.18.0
  - @checkstack/announcement-common@0.5.7
  - @checkstack/auth-backend@0.8.2
  - @checkstack/backend-api@0.26.1
  - @checkstack/cache-api@0.3.15
  - @checkstack/command-backend@0.2.14
  - @checkstack/signal-common@0.2.13
  - @checkstack/cache-utils@0.2.20

## 0.4.13

### Patch Changes

- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
  - @checkstack/backend-api@0.26.0
  - @checkstack/announcement-common@0.5.6
  - @checkstack/signal-common@0.2.12
  - @checkstack/auth-backend@0.8.1
  - @checkstack/cache-api@0.3.14
  - @checkstack/cache-utils@0.2.19
  - @checkstack/command-backend@0.2.13
  - @checkstack/common@0.17.0

## 0.4.12

### Patch Changes

- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/auth-backend@0.8.0
  - @checkstack/backend-api@0.25.0
  - @checkstack/common@0.17.0
  - @checkstack/command-backend@0.2.12
  - @checkstack/announcement-common@0.5.5
  - @checkstack/cache-api@0.3.14
  - @checkstack/signal-common@0.2.11
  - @checkstack/cache-utils@0.2.19

## 0.4.11

### Patch Changes

- Updated dependencies [2ec8f64]
  - @checkstack/auth-backend@0.7.2
  - @checkstack/backend-api@0.24.1
  - @checkstack/command-backend@0.2.11

## 0.4.10

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/backend-api@0.24.0
  - @checkstack/auth-backend@0.7.1
  - @checkstack/command-backend@0.2.10

## 0.4.9

### Patch Changes

- Updated dependencies [d2077bd]
  - @checkstack/auth-backend@0.7.0
  - @checkstack/backend-api@0.23.0
  - @checkstack/common@0.16.0
  - @checkstack/command-backend@0.2.9
  - @checkstack/announcement-common@0.5.4
  - @checkstack/cache-api@0.3.13
  - @checkstack/signal-common@0.2.10
  - @checkstack/cache-utils@0.2.18

## 0.4.8

### Patch Changes

- Updated dependencies [6005271]
- Updated dependencies [4134ed9]
  - @checkstack/backend-api@0.22.0
  - @checkstack/auth-backend@0.6.1
  - @checkstack/command-backend@0.2.8

## 0.4.7

### Patch Changes

- Updated dependencies [ebef442]
  - @checkstack/auth-backend@0.6.0
  - @checkstack/backend-api@0.21.7
  - @checkstack/command-backend@0.2.7

## 0.4.6

### Patch Changes

- @checkstack/backend-api@0.21.6
- @checkstack/auth-backend@0.5.6
- @checkstack/command-backend@0.2.6

## 0.4.5

### Patch Changes

- Updated dependencies [0626782]
- Updated dependencies [56e7c75]
  - @checkstack/backend-api@0.21.5
  - @checkstack/auth-backend@0.5.5
  - @checkstack/common@0.15.0
  - @checkstack/announcement-common@0.5.3
  - @checkstack/command-backend@0.2.5
  - @checkstack/cache-api@0.3.12
  - @checkstack/signal-common@0.2.9
  - @checkstack/cache-utils@0.2.17

## 0.4.4

### Patch Changes

- Updated dependencies [b50916d]
  - @checkstack/backend-api@0.21.4
  - @checkstack/auth-backend@0.5.4
  - @checkstack/command-backend@0.2.4

## 0.4.3

### Patch Changes

- @checkstack/announcement-common@0.5.2
- @checkstack/auth-backend@0.5.3
- @checkstack/backend-api@0.21.3
- @checkstack/cache-api@0.3.11
- @checkstack/cache-utils@0.2.16
- @checkstack/command-backend@0.2.3
- @checkstack/common@0.14.1
- @checkstack/signal-common@0.2.8

## 0.4.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/announcement-common@0.5.2
  - @checkstack/auth-backend@0.5.2
  - @checkstack/backend-api@0.21.2
  - @checkstack/cache-api@0.3.11
  - @checkstack/command-backend@0.2.2
  - @checkstack/signal-common@0.2.8
  - @checkstack/cache-utils@0.2.16

## 0.4.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/backend-api@0.21.1
  - @checkstack/cache-api@0.3.10
  - @checkstack/announcement-common@0.5.1
  - @checkstack/auth-backend@0.5.1
  - @checkstack/command-backend@0.2.1
  - @checkstack/signal-common@0.2.7
  - @checkstack/cache-utils@0.2.15

## 0.4.0

### Minor Changes

- 9dcc848: Align workspace dependency versions and migrate React Router to v7.

  BREAKING CHANGES (React Router v7): All frontend packages now depend on `react-router-dom@^7.16.0`. Previously the workspace declared four divergent ranges (`^6.20.0`, `^6.22.0`, `^7.1.1`, `^7.14.2`), which resolved both `react-router@6` and `react-router@7` into a single bundle. Everything is now unified on v7. The public imports the app uses (`BrowserRouter`, `Routes`, `Route`, `Link`, `NavLink`, `MemoryRouter`, `useNavigate`, `useParams`, `useSearchParams`, `useLocation`) are unchanged between v6 and v7, so no source rewrites were required - but any out-of-tree plugin still on react-router v6 should upgrade to v7 (see the React Router v6 -> v7 upgrade guide) to share the host's single router instance via the import map.

  Other unified ranges (no API change): `react` -> `^18.3.1`, the `@orpc/*` family (`contract`, `server`, `client`, `tanstack-query`, `openapi`, `zod`) -> `^1.14.4`, and `better-auth` -> `^1.6.13`.

  Removed the pre-rename `@orpc/react-query` leftover from `@checkstack/frontend-api`; its `createRouterUtils` / `RouterUtils` / `ProcedureUtils` now come from `@orpc/tanstack-query` (the package already in use).

  Stale in-range runtime deps pulled up to current published versions: `hono` `^4.12.23`, `@tanstack/react-query` (+devtools) `^5.100.14`, `date-fns` `^4.4.0`, `jose` `^6.2.3`, `tar` `^7.5.16`, `semver` `^7.8.1`, `@xyflow/react` `^12.11.0`.

### Patch Changes

- 9dcc848: Assorted bug fixes and small hardening across the platform.

  - announcement-backend: `updateAnnouncement` now invalidates the active-announcements and admin-list caches (it was missing the `invalidateAllActive` / `invalidateListAll` calls), so an edited announcement no longer stays stale up to the 45s TTL.
  - anomaly-backend: anomaly/drift state transitions (confirmations, recoveries, self-resolutions) now log at `debug` instead of info/warn - they are already surfaced via the `ANOMALY_STATE_CHANGED` signal, so logging them louder just added noise; genuine failure paths stay `warn`.
  - backend: the `/api/:pluginId/*` dispatcher now populates `requestHeaders` on the per-request RPC context, so a handler that re-enters the router as the originating user (e.g. an AI tool's user-scoped client) can forward the caller's session cookie / bearer - previously the loopback failed with "Authentication required". Guarded by a real end-to-end integration test. The HTTP server idle timeout is also raised (default 255s, configurable via `CHECKSTACK_SERVER_IDLE_TIMEOUT_SECONDS`, clamped 0-255, reset on each streamed chunk) so long AI chat SSE turns are not severed mid-stream.
  - backend: a request for an unknown plugin id (`/api/<unknown>/...`) now returns `404 Not Found` instead of `500` (and logs at warn, not error, since it is a client request) - an unknown _procedure_ on a known plugin already 404'd. The in-app docs namespace `/checkstack/*` now serves Starlight's own `404.html` with a real 404 status for a missing doc, instead of falling through to the SPA catch-all and 200-ing the app shell. Both guarded by tests.
  - automation-common: remove polynomial-time backtracking from `toShellEnvKey`'s underscore-trim (CodeQL `js/polynomial-redos`); a negative look-behind anchors the trailing run, keeping the trim linear.
  - common + script-packages-common: the pure transport-safe sandbox-policy schema (`sandboxPolicySchema` and its sub-schemas + inferred types) moved to `@checkstack/common` (the neutral base), removing two inverted deps that existed only to reach the shape; `@checkstack/backend-api` continues to re-export it. The schema is no longer exported from `@checkstack/script-packages-common`. Pure refactor, no behavior change.
  - catalog-backend: reject duplicate system names (a `CONFLICT` on create/rename, enforced by a pre-write check AND a new DB unique index on `systems.name`, migration 0004 which first resolves pre-existing duplicates by suffixing).
  - catalog-frontend: detail-page cleanups (use `<NotFound />` not `<AccessDenied />` on the not-found branch, a readable key/value metadata list via `normalizeMetadata`, runtime locale via `formatDate`); and stop the browse view re-rendering on every health report (adopt a new statuses report only when a value actually changed, via `healthStatusesEqual`, so rows stay stable and interactive).
  - healthcheck-backend: fix the daily-rollup retention step failing with an `ON CONFLICT` mismatch (SQLSTATE 42P10) after `environmentId` joined the `health_check_aggregates` unique constraint - the rollup now groups by (day, environmentId, sourceId) and uses a single exported conflict-target constant (`DAILY_AGGREGATE_CONFLICT_TARGET`) kept in lock-step with the schema by a unit test.
  - automation-frontend: the service-account picker's "Learn more" links are now absolute URLs to the deployed Astro docs site (they 404ed as in-app relative paths). The Monaco script editor double-init crash is fixed (serialized cold init, a guarded `monacoGuard` accessor, theme/type effects gated on `apiReady`).
  - auth-frontend: bound the desktop user-menu popover height (`max-h-[var(--radix-popover-content-available-height)]` + `overflow-y-auto`) so it no longer clips on short viewports, and fold the standalone `Account > Profile` item into a focusable name/email header (`profileHref` on `UserMenu`); the now-empty `Account` group no longer renders.
  - satellite-frontend: picked up via the sidebar-nav migration (account-only user menu).

  (Related UI fixes - the Monaco editor following the app theme, the `DynamicOptionsField` no-flash fix, the shared `Spinner`, GFM tables, and the user-menu popover bound - land their `@checkstack/ui` bump in the UI/perf changesets where `@checkstack/ui` is already minored.)

  This is a beta patch.

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
  - @checkstack/announcement-common@0.5.0
  - @checkstack/command-backend@0.2.0
  - @checkstack/cache-api@0.3.9
  - @checkstack/signal-common@0.2.6
  - @checkstack/cache-utils@0.2.14

## 0.3.13

### Patch Changes

- Updated dependencies [a57f7db]
  - @checkstack/backend-api@0.20.0
  - @checkstack/auth-backend@0.4.33
  - @checkstack/cache-api@0.3.8
  - @checkstack/command-backend@0.1.33
  - @checkstack/cache-utils@0.2.13

## 0.3.12

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
  - @checkstack/cache-api@0.3.7
  - @checkstack/command-backend@0.1.32
  - @checkstack/cache-utils@0.2.12

## 0.3.11

### Patch Changes

- Updated dependencies [6d52276]
- Updated dependencies [35bc682]
  - @checkstack/common@0.12.0
  - @checkstack/backend-api@0.18.0
  - @checkstack/announcement-common@0.4.2
  - @checkstack/auth-backend@0.4.31
  - @checkstack/command-backend@0.1.31
  - @checkstack/signal-common@0.2.5
  - @checkstack/cache-api@0.3.6
  - @checkstack/cache-utils@0.2.11

## 0.3.10

### Patch Changes

- @checkstack/backend-api@0.17.1
- @checkstack/auth-backend@0.4.30
- @checkstack/cache-api@0.3.5
- @checkstack/command-backend@0.1.30
- @checkstack/cache-utils@0.2.10

## 0.3.9

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
  - @checkstack/command-backend@0.1.29
  - @checkstack/announcement-common@0.4.1
  - @checkstack/signal-common@0.2.4
  - @checkstack/cache-api@0.3.4
  - @checkstack/cache-utils@0.2.9

## 0.3.8

### Patch Changes

- Updated dependencies [a06b899]
- Updated dependencies [a06b899]
  - @checkstack/backend-api@0.16.0
  - @checkstack/auth-backend@0.4.28
  - @checkstack/cache-api@0.3.3
  - @checkstack/command-backend@0.1.28
  - @checkstack/cache-utils@0.2.8

## 0.3.7

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
  - @checkstack/command-backend@0.1.27
  - @checkstack/cache-api@0.3.2
  - @checkstack/cache-utils@0.2.7

## 0.3.6

### Patch Changes

- Updated dependencies [9016526]
- Updated dependencies [080627f]
  - @checkstack/common@0.10.0
  - @checkstack/announcement-common@0.4.0
  - @checkstack/auth-backend@0.4.26
  - @checkstack/backend-api@0.15.2
  - @checkstack/command-backend@0.1.26
  - @checkstack/signal-common@0.2.3
  - @checkstack/cache-api@0.3.1
  - @checkstack/cache-utils@0.2.6

## 0.3.5

### Patch Changes

- Updated dependencies [42abfff]
- Updated dependencies [aa89bc5]
  - @checkstack/common@0.9.0
  - @checkstack/cache-api@0.3.0
  - @checkstack/announcement-common@0.3.2
  - @checkstack/auth-backend@0.4.25
  - @checkstack/backend-api@0.15.1
  - @checkstack/command-backend@0.1.25
  - @checkstack/signal-common@0.2.2
  - @checkstack/cache-utils@0.2.5

## 0.3.4

### Patch Changes

- Updated dependencies [50e5f5f]
  - @checkstack/announcement-common@0.3.1
  - @checkstack/backend-api@0.15.0
  - @checkstack/common@0.8.0
  - @checkstack/auth-backend@0.4.24
  - @checkstack/cache-api@0.2.4
  - @checkstack/cache-utils@0.2.4
  - @checkstack/command-backend@0.1.24
  - @checkstack/signal-common@0.2.1

## 0.3.3

### Patch Changes

- Updated dependencies [302cd3f]
  - @checkstack/backend-api@0.14.1
  - @checkstack/auth-backend@0.4.23
  - @checkstack/cache-api@0.2.3
  - @checkstack/command-backend@0.1.23
  - @checkstack/announcement-common@0.3.0
  - @checkstack/cache-utils@0.2.3
  - @checkstack/common@0.7.0
  - @checkstack/signal-common@0.2.0

## 0.3.2

### Patch Changes

- 32d52c6: chore: add `drizzle-kit` as a dev dependency

  Lets each backend package run `drizzle-kit generate` locally without
  relying on the workspace-level binary. No runtime impact — devDeps
  only.

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/backend-api@0.14.0
  - @checkstack/auth-backend@0.4.22
  - @checkstack/cache-api@0.2.2
  - @checkstack/command-backend@0.1.22
  - @checkstack/cache-utils@0.2.2

## 0.3.1

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/signal-common@0.2.0
  - @checkstack/announcement-common@0.3.0
  - @checkstack/backend-api@0.13.1
  - @checkstack/auth-backend@0.4.21
  - @checkstack/cache-api@0.2.1
  - @checkstack/command-backend@0.1.21
  - @checkstack/cache-utils@0.2.1

## 0.3.0

### Minor Changes

- 8d1ef12: ## Per-entity caching with single-flight + safe invalidation across the dashboard hot paths

  ### `@checkstack/cache-api`

  - **Breaking** for backend implementors: `CacheProvider` now requires `deleteByPrefix(prefix: string): Promise<number>` for family-level invalidation. The in-memory provider implements it; downstream providers (Redis, etc.) must add it before upgrading.
  - `createScopedCache` forwards `deleteByPrefix` and keeps prefixes scoped to the calling plugin.

  ### `@checkstack/cache-utils` (new package)

  High-level read-through caching helpers built on `CacheProvider`:

  - `createCachedScope({ cacheManager, pluginId })` returns a scope with `wrap`, `wrapMany`, `invalidate`, and `invalidatePrefix`.
  - **Single-flight**: concurrent cache misses for the same key share one loader.
  - **Per-entity bulk caching** via `wrapMany` so list/bulk RPCs cache by id rather than by the full input shape — overlapping callers share entries and invalidation stays exact.
  - **Race-safe invalidation** via per-key epoch counters: a loader started before a mutation cannot repopulate the cache with stale data after the mutation invalidates it. The mutation invariant is `db.write → cache.invalidate (await) → signals.emit`.
  - Cache failures fall through to the loader so a cache outage cannot break reads.

  ### `@checkstack/backend`

  - The internal null `CacheProvider` (used when no cache backend is configured) now implements the new `deleteByPrefix` method as a no-op. Patch bump only — no behavior change for existing callers.

  ### `@checkstack/healthcheck-backend`

  - `getSystemHealthStatus` and `getBulkSystemHealthStatus` now read through a per-system cache (`healthcheck:status:<systemId>`), eliminating N database queries per dashboard refresh for unchanged systems.
  - Mutation paths (configuration CRUD, system associations, satellite ingest, queue-driven check runs, system/satellite removal hooks) invalidate affected keys before broadcasting their signals so frontend refetches always observe fresh data.

  ### `@checkstack/incident-backend`

  - `listIncidents`, `getIncident`, `getIncidentsForSystem`, and `getBulkIncidentsForSystems` now read through a scoped cache:
    - per-incident at `incident:<id>`
    - per-system at `system:<systemId>`
    - per-filter-shape at `list:<stable-stringify(filters)>` for the few list shapes the dashboard polls
  - Mutations (`createIncident`, `updateIncident`, `addUpdate`, `resolveIncident`, `deleteIncident`) invalidate the incident, every affected system, and every cached list before broadcasting `INCIDENT_UPDATED`.
  - The catalog `systemDeleted` cleanup hook drops that system's cached entries.

  ### `@checkstack/maintenance-backend`

  - `listMaintenances`, `getMaintenance`, `getMaintenancesForSystem`, and `getBulkMaintenancesForSystems` use the same per-entity / per-system / per-filter-shape pattern as incidents.
  - Mutations (`createMaintenance`, `updateMaintenance`, `addUpdate`, `closeMaintenance`, `deleteMaintenance`) invalidate before broadcasting `MAINTENANCE_UPDATED`.

  ### `@checkstack/catalog-backend`

  - Topology reads (`getEntities`, `getSystems`, `getSystem`, `getGroups`, `getSystemGroupIds`) cache under the `entity:` family (25s TTL).
  - Views (`getViews`) and per-system contacts (`getSystemContacts`) cache in their own families.
  - System / group / membership mutations drop the entire `entity:` family (every reader joins the same tables); view and contact mutations drop only their respective scopes.

  ### `@checkstack/slo-backend`

  - `listObjectives`, `getObjective`, `getObjectivesForSystem`, and `getBulkObjectivesForSystems` cache results including the expensive `engine.computeStatus` output.
  - Per-entity caching for the bulk handler so dashboards with overlapping system sets share entries.
  - Mutations (`createObjective`, `updateObjective`, `deleteObjective`) invalidate before broadcasting `SLO_STATUS_CHANGED`.

  ### `@checkstack/anomaly-backend`

  - New `router-cache.ts` adds a cache scope distinct from the existing detector baseline cache, keyed by stable filter hash.
  - `getAnomalies` and `getAnomalyBaselines` cache through this scope (15s TTL).
  - The detector invalidates the router cache before broadcasting `ANOMALY_STATE_CHANGED` on every state transition (suspicious/anomaly/recovered).
  - Config mutations also invalidate.

  ### `@checkstack/notification-backend`

  - `getUnreadCount`, `getNotifications`, and `getSubscriptions` cache per-user.
  - `markAsRead`, `deleteNotification`, `notifyUsers`, and `notifyGroups` invalidate every affected user's cache before sending realtime signals to that user.
  - `subscribe` and `unsubscribe` invalidate the user's subscription cache.

  ### `@checkstack/announcement-backend`

  - `getActiveAnnouncements` caches per-user (or anonymous) and per-`includeDismissed` flag (45s TTL — admin-driven, slowly changing).
  - `listAllAnnouncements` caches under a single key.
  - `dismissAnnouncement` only drops that user's cache; `createAnnouncement`, `updateAnnouncement`, `deleteAnnouncement` drop every user's cache before broadcasting `ANNOUNCEMENT_UPDATED`.
  - The auth `userDeleted` cleanup hook drops that user's cached entries.

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/common@0.7.0
  - @checkstack/cache-api@0.2.0
  - @checkstack/cache-utils@0.2.0
  - @checkstack/backend-api@0.13.0
  - @checkstack/announcement-common@0.2.2
  - @checkstack/auth-backend@0.4.20
  - @checkstack/command-backend@0.1.20
  - @checkstack/signal-common@0.1.10

## 0.2.5

### Patch Changes

- Updated dependencies [889dd8c]
  - @checkstack/auth-backend@0.4.19

## 0.2.4

### Patch Changes

- Updated dependencies [26d8bae]
  - @checkstack/backend-api@0.12.0
  - @checkstack/auth-backend@0.4.18
  - @checkstack/command-backend@0.1.19

## 0.2.3

### Patch Changes

- Updated dependencies [d1a2796]
  - @checkstack/common@0.6.5
  - @checkstack/backend-api@0.11.1
  - @checkstack/auth-backend@0.4.17
  - @checkstack/announcement-common@0.2.1
  - @checkstack/command-backend@0.1.18
  - @checkstack/signal-common@0.1.9

## 0.2.2

### Patch Changes

- Updated dependencies [54a5f80]
  - @checkstack/backend-api@0.11.0
  - @checkstack/auth-backend@0.4.16
  - @checkstack/command-backend@0.1.17

## 0.2.1

### Patch Changes

- @checkstack/backend-api@0.10.1
- @checkstack/auth-backend@0.4.15
- @checkstack/command-backend@0.1.16

## 0.2.0

### Minor Changes

- dee86ec: feat: add portal announcement system

  Introduces a complete announcement system for communicating with portal users:

  - **announcement-common**: Zod schemas for announcements (severity, visibility, display mode), oRPC contract with 6 procedures (public retrieval, user dismissal, admin CRUD), access rules, and `ANNOUNCEMENT_UPDATED` signal definition
  - **announcement-backend**: Drizzle schema with `announcements` and `announcement_dismissals` tables, router with temporal filtering, visibility control, per-user dismissal persistence, user cleanup hook, real-time signal broadcasting on create/update/delete, and command palette registration ("Create Announcement", "Manage Announcements" with `⇧⌘A` shortcut)
  - **announcement-frontend**: Admin management page with create/edit dialog, global banner component above the navbar (severity-colored, expandable markdown), dashboard cards with compact expand/collapse, admin menu link, and real-time WebSocket signal subscription for instant UI updates
  - **frontend**: Integrates AnnouncementBanner into App.tsx for global visibility

### Patch Changes

- Updated dependencies [dee86ec]
  - @checkstack/announcement-common@0.2.0
