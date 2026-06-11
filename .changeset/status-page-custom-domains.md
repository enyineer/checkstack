---
"@checkstack/backend-api": minor
"@checkstack/backend": minor
"@checkstack/frontend-api": minor
"@checkstack/frontend": minor
"@checkstack/status-page-common": minor
"@checkstack/status-page-backend": minor
"@checkstack/status-page-frontend": minor
---

Status pages: first-class custom domains with a locked-down public surface.

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
`status_pages` table (additive migration). Third-party widget renderers do not
yet load on a custom domain (they still render at `/status/<slug>`); this is a
documented follow-up and does not affect data isolation.
