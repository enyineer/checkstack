---
"@checkstack/announcement-frontend": minor
"@checkstack/announcement-backend": patch
"@checkstack/backend": patch
---

Render the announcement block on public status pages (serve core plugins as Module Federation remotes)

Thanks to @stuajnht for reporting: the Announcements block never rendered on a
public status page - the lean public bundle (used for both a custom domain and
the same-origin `/statuspage/view/:slug` path) loads NO plugins, and the
announcement renderer lives in a core frontend plugin that was only ever bundled
into the admin app. Declaring the widget's `rendererRemote` was necessary but not
sufficient: core plugins were never built or served as remotes, so the public
bundle's `loadRemote` 404'd and the block stayed blank.

BREAKING CHANGE (mechanism, not API): core frontend plugins can now ship a public
Module Federation remote so the lean public bundle can load their status-page
widget renderers on demand - the same mechanism third-party plugins use.

- `@checkstack/announcement-frontend` gains a federation `vite.config.ts` and a
  `build` script that emit a remote (`mf-manifest.json` + `remoteEntry.js`),
  exposing a LEAN public entry (`public-plugin.tsx`) that contributes ONLY the
  status-widget renderer - not the admin routes/manage page - so the remote stays
  small and avoids the heavy `@checkstack/ui` surface. It shares only `react`,
  `@checkstack/frontend-api`, and (consume-only) `@checkstack/ui/code-editor` with
  the host; react-dom / react-query are left unshared so their dead transitive
  code bundles and tree-shakes rather than breaking the federated consume shim.
- Opt in with `checkstack.publicRemote: true` in the plugin's package.json. The
  backend plugin discovery now syncs such core frontend plugins into the
  `plugins` table so `/assets/plugins/<name>/*` serves their `dist/` (ordinary
  core frontend plugins, bundled into the admin app, are unaffected and excluded
  from the admin remote list).
- Build wiring: a new `bun run build:public-remotes` builds every
  `publicRemote` plugin (single source of truth: the same marker discovery uses),
  wired into the `Dockerfile` builder stage and the e2e `pretest:e2e`; the
  runtime image copies each remote's `dist/`.

Verified end to end in a real browser: the public page fetches the remote's
`mf-manifest.json` / `remoteEntry.js` (200), Module Federation loads it against
the host's shared React/frontend-api, and the announcement renders (with its
markdown) - no console errors.
