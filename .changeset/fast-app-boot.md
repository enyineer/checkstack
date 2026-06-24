---
"@checkstack/frontend": minor
"@checkstack/frontend-api": minor
"@checkstack/backend": minor
---

Speed up app loading: inline boot config, load plugins non-blocking, stream the shell

The SPA used to hold a full-page spinner through a serial boot waterfall before
first paint: it fetched `/api/config` (twice) and `/api/plugins`, then awaited
every plugin's registration before rendering anything.

- **Inlined bootstrap (backend).** The backend now injects a small
  non-user-specific blob (`config` + `enabledPlugins`) into the served HTML, and
  the frontend reads it synchronously via `readBootstrap()`. This removes the
  boot-time `/api/config` and `/api/plugins` round-trips entirely. The per-user
  session is not inlined (it stays a better-auth fetch); the HTML is served
  `no-cache`. The Vite dev server has no blob, so it falls back to the original
  fetches.
- **Non-blocking plugin load (frontend).** Local (bundled) plugins register
  synchronously and the shell renders immediately; remote (installed) plugins
  load in the background and register reactively, so first paint no longer waits
  on the plugin network phase.
- **Skeleton-streamed first paint (frontend).** Route pages and the
  pre-providers window now show content/shell skeletons instead of full-page
  spinners, so the chrome stays put and only content streams in.

`RuntimeConfigProvider` seeds from the inlined config and skips the reachability
probe for a same-origin `baseUrl`; a misconfigured cross-origin `BASE_URL` still
surfaces the same loud error.
