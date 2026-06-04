---
"@checkstack/backend": patch
"@checkstack/dev-server": patch
"@checkstack/scripts": patch
---

Fix the external/published-install dev loop and scaffolded-plugin first-boot (the #251 published-tarball integration lane).

Backend:

- `CHECKSTACK_DEV_AUTH=true` now actually takes effect for plugin APIs: dev auth is registered as a FACTORY (not a plain instance) so `ServiceRegistry.get()` reaches it instead of resolving the real auth factory first - previously every plugin API request under dev auth 401ed.
- `CHECKSTACK_DEV_AUTH=true` no longer fatally crashes boot: dev-auth passes through real S2S tokens in `authenticate()` and mints a real plugin-scoped service token in `getCredentials()`, registered per plugin so each carries its own id - so boot-time backend-to-backend calls (e.g. `notification.registerSubscriptionSpec`) are accepted. A `PORT` env override is added to the backend entry point.
- A dev-loaded plugin's Drizzle migrations now run on boot: `loadPlugins` accepts an optional `manualPluginPaths` map and the dev path supplies `CHECKSTACK_DEV_PLUGIN_PATH` so the plugin's `drizzle/` migrations run (previously manual plugins booted with no tables).

dev-server:

- The Vite frontend dev server now starts from a published install: `@checkstack/frontend` is resolved from a candidate list (the plugin first, then dev-server's own install), a `checkstack.bundle`-referenced `-frontend` sibling is picked up by scanning sibling dirs, and resolution failures yield a clean `undefined`/`Error` instead of Bun's non-`Error` throw (which had surfaced as "An error occurred").
- The dev shell is now styled from a published install: `@checkstack/frontend` moves `tailwindcss`, `autoprefixer`, and `tailwindcss-animate` to dependencies and exports a `./tailwind-preset` subpath; the dev server assembles the PostCSS chain from that preset + autoprefixer and injects the plugin-under-dev's source globs into Tailwind's `content` (so a plugin author's custom utility classes compile), degrading gracefully if the toolchain can't be loaded. (`@checkstack/frontend` now declares an `exports` field, a BREAKING change for any consumer importing an undeclared subpath; nothing in the platform imports it as a module, and a `./*` passthrough preserves filesystem-style subpath access. The `@checkstack/frontend` minor bump for this lands in the version-alignment / frontend-bundle-perf changesets.)
- `--help` output corrected from the stale `checkstack-scripts dev` to `checkstack-dev`, with a note that the binary ships in `@checkstack/dev-server`.

scripts (scaffold):

- The standalone backend template now ships a generated `drizzle/0000_init` migration creating the example `items` table, and `drizzle.config.ts` `out` points at `./drizzle` (the folder the loader reads), so a scaffolded plugin serves its API on first `bun install && bun run dev` instead of 500ing with "relation \"items\" does not exist".
- The `common` template's `definePluginMetadata({ pluginId })` now renders the bare base name (not `<base>-common`), matching the backend's `checkstack.pluginId` and `/api/<pluginId>/*` route, fixing "Plugin metadata not found in registry".

This is a beta patch.
