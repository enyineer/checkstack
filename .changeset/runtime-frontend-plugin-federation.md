---
"@checkstack/frontend": minor
"@checkstack/scripts": minor
"@checkstack/backend": minor
"@checkstack/ui": minor
---

Make installed (runtime) frontend plugins actually load, via Module Federation 2.0. Previously a packed external plugin's frontend could not run: the host only shared React/router with runtime plugins, and there was no working way to share the framework/UI singletons (hand-rolled import-map externalisation hit an unsolvable rolldown CJS-interop wall).

- **Host (`@checkstack/frontend`)** now uses `@module-federation/vite` as an MF host and loads runtime plugins through the MF runtime (`registerRemotes` + `loadRemote`) instead of a raw `import()`. The shared set (react, react-dom, react-router-dom, @tanstack/react-query, @checkstack/frontend-api) is owned by the host; plugins reuse those exact instances via the share scope. The old hand-rolled vendor build + import map are removed.
- **`@checkstack/ui`** is bundled per consumer (tree-shaken); its Theme / Toast / Performance React contexts are unified across the host and bundled-in-plugin copies via a registered (globalThis-keyed) context, so a plugin's `useTheme`/`useToast`/`usePerformance` resolve to the host's providers.
- **Scaffold + pack (`@checkstack/scripts`)** build frontend plugins as MF remotes (`vite build` with the federation plugin, exposing `./plugin`, manifest enabled, DTS disabled, Monaco/VS Code stack externalised). `plugin-pack` builds frontend packages with `NODE_ENV=production` (the MF plugin skips the remote under `NODE_ENV=test`) and ships only `dist/`. The scaffolded route now declares a `nav` entry so it appears in the sidebar.
- **Backend (`@checkstack/backend`)** serves a plugin's MF assets under its (possibly scoped) package name (`/assets/plugins/@scope/name/*`), with correct content types, and the SPA catch-all defers those paths so the federation manifest/remoteEntry are not shadowed by `index.html`.

Verified end-to-end by the external-plugin install E2E (scaffold → pack → install via the Plugin Manager UI → frontend + backend + co-loaded core plugins all work).
