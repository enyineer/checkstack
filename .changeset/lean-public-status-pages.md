---
"@checkstack/frontend": minor
"@checkstack/backend": minor
"@checkstack/backend-api": minor
"@checkstack/ui": minor
"@checkstack/auth-frontend": minor
"@checkstack/command-frontend": minor
"@checkstack/signal-frontend": minor
"@checkstack/announcement-frontend": minor
"@checkstack/status-page-common": minor
"@checkstack/status-page-backend": minor
"@checkstack/status-page-frontend": minor
---

Serve public status pages from the lean bundle, and stop the SPA entry pulling the whole UI kit

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
