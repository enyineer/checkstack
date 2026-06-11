# @checkstack/status-page-common

## 0.1.0

### Minor Changes

- 9ab73c5: Status pages: configurable incident/maintenance updates + recently resolved/completed items.

  The Incidents and Maintenance widgets gain four config options (in the builder):

  - **Show updates** (default on) — render the per-item update timeline so visitors
    can follow progress. The maintenance widget now renders its timeline too
    (previously it fetched updates but didn't show them). Turning this off also
    skips the per-item detail fetch (a perf win).
  - **Max updates per item** (default 3) — show only the latest N updates,
    most-recent first, so a chatty incident doesn't dominate the page.
  - **Show recently resolved / completed** (default off) — include resolved
    incidents / completed maintenances, rendered in a separate "Recently resolved"
    / "Past maintenance" subsection below the active items.
  - **Max age (days)** (default 7) — only include past items resolved/completed
    within the window.

  Scoping and isolation are unchanged: still only the systems the operator bound,
  still fail-closed when none are bound, still field-allow-listed DTOs (no
  `createdBy`). The active/past partition + max-age + cap is a pure, unit-tested
  helper (`selectEvents`).

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
  - @checkstack/common@0.16.0
