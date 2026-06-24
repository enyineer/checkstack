---
title: "App boot and the bootstrap contract"
description: "How the Checkstack SPA boots: the server-inlined bootstrap blob, non-blocking plugin loading, and skeleton-streamed first paint."
---

This page documents how the Checkstack admin and public bundles start up, the
server-to-client bootstrap contract that removes the boot-time network
waterfall, and why the shell paints before plugins finish loading. It is host
internals: plugin authors rarely touch any of this, but it explains why a plugin
route appears slightly after the shell.

## The bootstrap contract

The backend inlines a small, non-user-specific JSON blob into the served HTML so
the SPA can read its config and plugin list synchronously, with zero network
round-trips, before it renders.

The blob is written as a global immediately before the entry module script:

```html
<script>
  window.__CHECKSTACK_BOOTSTRAP__ = {
    "config": { "baseUrl": "https://app.example.com" },
    "enabledPlugins": [{ "name": "@acme/widget-frontend", "path": "/dist" }]
  };
</script>
<script type="module" crossorigin src="/mf-entry-bootstrap-...js"></script>
```

- `config` is the same payload `/api/config` returns (the API/WS `baseUrl`, plus
  an opaque `publicHost` hint on a custom-domain public host).
- `enabledPlugins` is the same payload `/api/plugins` returns: the remote
  (installed) frontend plugins to load as Module Federation remotes. It is empty
  on a public host.

The per-user session is deliberately **not** inlined; it stays a better-auth
fetch so the served HTML never carries user-specific data. The HTML is served
`Cache-Control: no-cache` (it changes when an operator installs a plugin), while
the hashed `/assets/*` chunks stay immutably cacheable.

> [!NOTE]
> The Vite dev server serves a static `index.html` with no inlined blob. When
> the global is absent, the frontend falls back to fetching `/api/config` and
> `/api/plugins`, so dev behaves exactly as before.

### Server side

The injection is a pure function, `injectBootstrap`, in `@checkstack/backend`.
It escapes every `<` in the serialized JSON to its unicode escape form so a
value (e.g. a status-page slug) can never break out of the `<script>` element. The SPA
fallback route reads the bundle HTML, injects the blob, and serves it.

### Client side

`@checkstack/frontend-api` exposes `readBootstrap()`, which returns the parsed
blob (or `undefined` in dev). It is consumed in two places:

- `main.tsx` reads `config.publicHost` to choose the admin or public bundle and
  passes `enabledPlugins` to the remote-plugin loader, all without a fetch.
- `RuntimeConfigProvider` seeds its config from the blob. A seeded config whose
  `baseUrl` is the current origin is trivially reachable, so the provider
  renders immediately and skips the reachability probe. A seeded cross-origin
  `baseUrl` (the rare misconfigured `BASE_URL` case) still runs the
  fetch-and-probe path so the loud diagnostic is preserved.

## Plugin loading

Local (bundled) plugins are registered BEFORE the first render, because shell
chrome depends on plugin-contributed APIs at render time (for example the
sidebar's `useAccessRules` resolves the auth plugin's `auth.api`). They use a
NON-eager glob, so each plugin `index.tsx` is its own chunk and the browser
downloads them in parallel rather than as one large eager bundle:

```ts
// main.tsx (admin bundle)
await loadLocalPlugins();        // parallel per-plugin chunks, then register
root.render(<App />);
void loadRemotePlugins({ enabledPlugins: boot?.enabledPlugins });
```

Remote (installed) plugins load AFTER first paint and register reactively
against the plugin registry (a `useSyncExternalStore` source), so their routes
and nav entries appear without blocking. The combined `loadPlugins` helper
(register resolved modules, then load remotes) is retained for the dev server
and tests.

> [!NOTE]
> Making first paint happen BEFORE local plugins load requires decoupling the
> shell chrome from plugin-contributed APIs (today the sidebar and command
> shortcuts read them synchronously). That is a separate refactor; until then,
> local plugins are a first-paint prerequisite on the admin origin. Public
> surfaces avoid this entirely by using the lean bundle below.

> [!TIP]
> Keep the shell's own static imports lean. Importing one provider/hook from a
> package whose barrel is not tree-shakeable drags that package's whole component
> graph into first paint. The shell-imported packages declare `sideEffects` (CSS
> only) so a `SessionProvider` import does not pull, say, an admin settings form.
> Heavy, conditionally-rendered shell content (e.g. the announcement banner's
> Markdown body) is behind `React.lazy`.

## Lean public bundle for public surfaces

A request is a PUBLIC surface when it is a custom-domain host (`publicHost` set)
OR its path matches a backend-advertised public prefix. Plugins declare those
prefixes through the platform's `publicPathExtensionPoint`; the backend returns
them in `/api/config` and the inlined boot blob. `main.tsx` then loads the
minimal `public-app` (no admin app, no plugin loader, no eager plugin
components) for those paths, driving the slug from the URL. A published status
page at `/statuspage/view/:slug` therefore loads none of the admin frontend.

## Skeleton-streamed first paint

There is no SSR; the SPA equivalent of streaming is to render the static shell
chrome immediately and let each region fill via Suspense with skeletons rather
than a full-page spinner:

- A lazily-loaded route page suspends with a content-area `PageSkeleton`, so the
  header and sidebar stay rendered around it.
- The brief pre-providers window (only reached in dev or for a cross-origin
  `baseUrl`) shows a full `ShellSkeleton` instead of a centered spinner.

The inline boot splash in `index.html` (a no-JS, theme-aware spinner) still
covers the window between HTML parse and the first React commit; it is removed
once the app mounts.
