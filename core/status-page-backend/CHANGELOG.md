# @checkstack/status-page-backend

## 0.4.7

### Patch Changes

- Updated dependencies [390d9cf]
  - @checkstack/backend-api@0.30.0
  - @checkstack/command-backend@0.2.20

## 0.4.6

### Patch Changes

- Updated dependencies [c55d7c6]
  - @checkstack/common@0.21.0
  - @checkstack/backend-api@0.29.1
  - @checkstack/command-backend@0.2.19
  - @checkstack/status-page-common@0.5.2

## 0.4.5

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/backend-api@0.29.0
  - @checkstack/common@0.20.0
  - @checkstack/command-backend@0.2.18
  - @checkstack/status-page-common@0.5.1

## 0.4.4

### Patch Changes

- Updated dependencies [e819276]
  - @checkstack/backend-api@0.28.0
  - @checkstack/command-backend@0.2.17

## 0.4.3

### Patch Changes

- @checkstack/backend-api@0.27.1
- @checkstack/command-backend@0.2.16

## 0.4.2

### Patch Changes

- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [0d912a3]
  - @checkstack/common@0.19.0
  - @checkstack/backend-api@0.27.0
  - @checkstack/status-page-common@0.5.0
  - @checkstack/command-backend@0.2.15

## 0.4.1

### Patch Changes

- Updated dependencies [defb97b]
  - @checkstack/common@0.18.0
  - @checkstack/backend-api@0.26.1
  - @checkstack/command-backend@0.2.14
  - @checkstack/status-page-common@0.4.1

## 0.4.0

### Minor Changes

- 2e20792: Serve public status pages from the lean bundle, and stop the SPA entry pulling the whole UI kit

  Public status pages used to render inside the full admin app on same-origin
  paths, so opening one booted every plugin (and its eager slot components) and the
  entire `@checkstack/ui` barrel.

  - **Lean public bundle for public paths.** New platform extension point
    `publicPathExtensionPoint` lets a plugin declare same-origin public path
    prefixes; the backend advertises them via `/api/config` and the inlined boot
    blob. The SPA entry now loads the minimal public bundle (no admin app, no
    plugin loader, no eager plugin components) for those paths, driving the slug
    from the URL. A status page no longer loads any admin frontend code.
  - **Entry no longer imports the `@checkstack/ui` barrel.** `ThemeProvider` /
    `DensityProvider` moved from `main.tsx` into each bundle's root (`App` and
    `public-app`), cutting the critical-path preload from ~280 KB to ~0.5 KB gz on
    both bundles (the barrel now loads only inside the bundle that needs it).
  - **public-app provider fix.** Added the missing `ToastProvider` (required by
    `PerformanceProvider`) so the public bundle renders standalone.
  - **Local plugins load as parallel chunks.** The bundled plugins moved from one
    eager `import.meta.glob` chunk to per-plugin lazy chunks downloaded in
    parallel. They are still registered before first render (the shell chrome
    depends on plugin-contributed APIs such as the auth plugin's `auth.api`), and
    remote plugins continue to load after first paint and register reactively.
  - **Tree-shakeable barrels.** `@checkstack/ui`, `auth-frontend`,
    `command-frontend`, `signal-frontend`, and `announcement-frontend` now declare
    `sideEffects` (CSS only), so importing one provider/hook no longer drags a
    whole package's components into the shell. `AnnouncementBanner` also lazy-loads
    its Markdown renderer, keeping ~98 KB of react-markdown out of first paint.

  BREAKING CHANGE: status-page route ids now match the `statuspage` plugin id (the
  frontend route registry requires this). URLs change: the admin builder moves from
  `/status-pages` to `/statuspage` (and `/status-pages/:id` to `/statuspage/:id`),
  and the public page moves from `/status/:slug` to `/statuspage/view/:slug`. Update
  any bookmarks or external links to published status pages.

### Patch Changes

- Updated dependencies [2e20792]
  - @checkstack/backend-api@0.26.0
  - @checkstack/status-page-common@0.4.0
  - @checkstack/command-backend@0.2.13
  - @checkstack/common@0.17.0

## 0.3.0

### Minor Changes

- 8cad340: feat(status-pages): page-wide overall-status summary banner

  The public status page now shows a page-wide status banner at the top,
  summarising the whole page in one line (for example "All systems
  operational" or "Major outage").

  - `status-page-common` gains a pure, fully unit-tested
    `deriveOverallStatus({ blocks })` plus an `OverallStatusSummary`
    (`{ status, label }`) zod schema/type. The summary reuses the existing
    public status vocabulary (`operational` / `degraded` / `partial_outage`
    / `major_outage` / `maintenance` / `unknown`).
  - The published-page DTO (`PublishedStatusPageSchema`) now carries a
    required `overallStatus` field. The backend resolver derives it from the
    blocks it already resolves - worst-status-wins over each block's public
    DTO - so it adds no new data exposure and no domain-plugin dependency
    (it reads only the field-allow-listed widget output the resolver already
    produces).
  - `status-page-frontend` renders the banner at the top of the public page
    (shared by the in-app and custom-domain surfaces) using the existing
    semantic status tokens, so the banner always matches the widgets below.

  BREAKING: `PublishedStatusPageSchema` now requires `overallStatus`.
  Consumers that build a `PublishedStatusPage` by hand must include it; the
  status-page resolver populates it automatically.

### Patch Changes

- 8cad340: Widen Cmd+K command-palette coverage to every top-level sidebar destination.

  The command palette previously only surfaced commands from a handful of plugins,
  so large feature areas were silently unreachable from search. Each of these
  plugins now registers a "navigate to <feature>" command per top-level route via
  `registerSearchProvider`, so every sidebar destination they own is reachable
  from Cmd+K (entity search can come later):

  - dependency: "Dependency Map"
  - status-page: "Status pages"
  - satellite: "Satellites"
  - gitops: "GitOps", "Kind Registry"
  - secrets: "Secrets"
  - notification: "Notification Settings"
  - script-packages: "Script Packages", "Script Sandbox"

  Each command reuses the plugin's own route helper (`resolveRoute`) for its href
  and carries the same access rule that gates its sidebar nav entry, so palette
  visibility matches sidebar visibility. The notification command carries no
  access rule, matching its authenticated-only nav entry.

- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/backend-api@0.25.0
  - @checkstack/common@0.17.0
  - @checkstack/command-backend@0.2.12
  - @checkstack/status-page-common@0.3.0

## 0.2.1

### Patch Changes

- Updated dependencies [2ec8f64]
  - @checkstack/backend-api@0.24.1

## 0.2.0

### Minor Changes

- b1a5f3c: Status pages: first-class custom domains with a locked-down public surface.

  A published status page can now be served on its own host (e.g. `status.acme.com`),
  isolated from the admin UI at three layers:

  - **Data.** A new platform extension point (`publicHostResolverExtensionPoint` in
    `@checkstack/backend-api`) lets the owning plugin map an incoming `Host` to a
    published page. On a matched custom domain, a core host-routing middleware
    serves ONLY the single public read (`getPublishedStatusPage`), `/api/config`,
    the public bundle's assets, and the on-demand-TLS hook. Every other `/api/*`,
    all of `/rest/*`, the admin docs, and the platform endpoints
    (`/.checkstack/*`, `/.well-known/jwks.json`) return 404. `/api/config` returns
    the custom domain itself as `baseUrl`, so the bundle's RPC client can only
    call back into the same locked-down origin - never the admin origin.
  - **Code.** The custom-domain host loads a separate minimal public bundle that
    ships none of the admin app (no sidebar, auth, signals, command palette, or
    plugin loader). The frontend entry checks `/api/config` first and dynamically
    imports only the public bundle on a public host, so the admin chunk is never
    fetched there.
  - **Ownership.** Domains are added in the builder, verified via a DNS TXT record
    (`_checkstack-verify.<domain>`), and route only once verified AND published.
    An `/.well-known/checkstack/authorize-domain` hook lets an on-demand-TLS edge
    (Caddy, Cloudflare for SaaS, cert-manager automation) mint certificates only
    for verified domains. TLS is terminated at the edge, matching how the platform
    already serves its primary domain.

  Builder gains a Custom domain panel (set / verify / remove + DNS instructions).

  Widget renderers are now pluggable too. A plugin that contributes a backend
  widget type can ship its frontend renderer with `defineStatusWidgetRenderer`
  (in `@checkstack/status-page-common`) via its `extensions[]`; the status-page
  frontend resolves each block's renderer by id, merging built-ins (which win on a
  clash) with plugin-contributed ones. Previously only the built-in renderers
  existed, so a third-party widget type had no way to draw on a page.

  Third-party renderers work on custom domains too. A backend widget type can
  declare `rendererRemote` (its frontend npm package); the published-page response
  then lists exactly the renderer remotes that page needs, and the minimal
  custom-domain bundle loads only those on demand via Module Federation. The set
  is derived from the page's widget types (operator-controlled, never visitor
  input) and the loaded code is the operator's own trusted plugin, so it does not
  widen the data surface (the only reachable data endpoint on a public host is
  still the single public read).

  Hardening (from review): WebSocket upgrades are gated on custom-domain hosts
  (they bypass the HTTP middleware), so no socket endpoint is reachable there;
  custom domains route ONLY `public`-visibility published pages (an
  `authenticated` page never routes nor leaks its slug); `setCustomDomain` rejects
  the platform's own host, IP literals, and internal suffixes; and the host-lookup
  cache is size-bounded against unique-host floods. The host-routing decision is
  unit-tested.

  NOT breaking. New `status-page-common` contract procedures (`setCustomDomain`,
  `verifyCustomDomain`, `removeCustomDomain`) and `customDomain*` columns on the
  `status_pages` table (additive migration).

  (`@checkstack/ai-backend` is a patch only: its generated docs index now includes the custom-domain documentation.)

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/backend-api@0.24.0
  - @checkstack/status-page-common@0.2.0

## 0.1.0

### Minor Changes

- 5c6393f: Add operator-built public Status Pages (phase 1: secure, extensible core).

  Operators compose a public status page from widgets (status banner, system
  health, group status, 90-day uptime, incidents, scheduled maintenance) plus
  content blocks (text/Markdown, heading, links, image, divider), each bound to the
  resources they choose, then publish it.

  Security model — "only published widgets reveal data":

  - A single public endpoint, `getPublishedStatusPage(slug)`, returns the layout
    plus each widget's already-resolved, field-ALLOW-LISTED DTO. The public surface
    has no generic data API, so it can only ever show what was placed on the page.
  - Three gates: edit-time (you can only bind resources you can access), publish-time
    (an audited, deliberate exposure that re-checks the editor can read every bound
    resource via a user-scoped client), and render-time (resolvers run as a trusted
    service but emit only DTO fields — never internal config, ids, or `createdBy`;
    the service re-validates each DTO against its schema, so a resolver bug fails
    closed).
  - The overall banner rolls up only the bound systems; private resources are never
    exposed beyond their public-safe status; per-binding label overrides avoid
    internal-name leaks.

  Coherence + extensibility:

  - Status pages are team-scopable resources (RLAC): created via the standard
    owning-team picker + create-capability flow, resolvable by name in the Teams
    admin.
  - Widget types come from an extension-point registry, so any plugin can contribute
    a widget (config schema + public DTO + `resolvePublic`); the public renderers
    are pure, prop-only components with no data access, so third-party widgets can
    never leak.
  - Draft vs published layouts; per-page visibility (public / authenticated-only)
    and theming (brand color, logo).

  Dependency direction: the status-page platform owns the widget-type registry and
  the content widgets, but the DOMAIN widgets are contributed by their owning
  plugins via the `statusWidgetTypeExtensionPoint` — system health / uptime /
  banner / group status by `healthcheck-backend`, incidents by `incident-backend`,
  scheduled maintenance by `maintenance-backend`. So `status-page-backend` depends
  only on `backend-api` / `common` / `status-page-common`; the owning plugins
  depend on the platform, never the reverse. `catalog-common` gains
  `assertCatalogResourcesReadable` for the publish-time access check.

  Phase 1 scope: the secure core, the admin builder, and the public page (served as
  a no-access-rule route). A fully separate public bundle, custom domains + TLS,
  drag-reorder, live-data preview, and distribution (embeds/badges/RSS/subscriptions)
  are the next phases.

### Patch Changes

- Updated dependencies [d2077bd]
- Updated dependencies [9ab73c5]
- Updated dependencies [5c6393f]
  - @checkstack/backend-api@0.23.0
  - @checkstack/common@0.16.0
  - @checkstack/status-page-common@0.1.0
