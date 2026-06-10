---
"@checkstack/status-page-common": minor
"@checkstack/status-page-backend": minor
"@checkstack/status-page-frontend": minor
---

Add operator-built public Status Pages (phase 1: secure, extensible core).

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

Phase 1 scope: the secure core, the admin builder, and the public page (served as
a no-access-rule route). A fully separate public bundle, custom domains + TLS,
drag-reorder, live-data preview, and distribution (embeds/badges/RSS/subscriptions)
are the next phases.
