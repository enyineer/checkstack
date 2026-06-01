---
"@checkstack/frontend-api": minor
"@checkstack/frontend": minor
"@checkstack/scripts": minor
"@checkstack/about-frontend": minor
"@checkstack/announcement-frontend": minor
"@checkstack/anomaly-frontend": minor
"@checkstack/api-docs-frontend": minor
"@checkstack/automation-frontend": minor
"@checkstack/catalog-frontend": minor
"@checkstack/dashboard-frontend": minor
"@checkstack/dependency-frontend": minor
"@checkstack/gitops-frontend": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/incident-frontend": minor
"@checkstack/infrastructure-frontend": minor
"@checkstack/integration-frontend": minor
"@checkstack/maintenance-frontend": minor
"@checkstack/notification-frontend": minor
"@checkstack/pluginmanager-frontend": minor
"@checkstack/satellite-frontend": minor
"@checkstack/script-packages-frontend": minor
"@checkstack/secrets-frontend": minor
"@checkstack/slo-frontend": minor
---

Harden the frontend plugin contribution contract: lazy-by-default, framework-owned loading, and runtime-addable.

BREAKING (frontend plugin contract): plugins now declare contributions lazily and let the framework own code-splitting, Suspense, and error isolation, instead of handing over eager React elements.

- **Routes** now use `load: () => import("./Page").then((m) => ({ default: m.Page }))` instead of `element: <Page />`. The framework wraps each route in `React.lazy` + Suspense + a per-plugin error boundary. `element` is still accepted for the rare page that must paint without a chunk fetch (e.g. the login page); provide exactly one of `load` / `element`.
- **Slot extensions** accept either an eager `component` (light, always-on contributions - navbar/user-menu/badges) or a lazy `load` (heavy/page-scoped contributions - dashboards, editors, chart panels). New `getLazyContribution` + `ExtensionComponent` exports from `@checkstack/frontend-api` render either kind uniformly.

This also fixes two gaps that runtime-installed (remote/external) plugins depend on:
- `ExtensionSlot` now subscribes to the plugin registry, so a plugin added at runtime appears in navbar/dashboard/detail slots without a reload.
- The app's API registry rebuilds when the plugin set changes (`getPlugins()` now returns an immutable snapshot consumed via `useSyncExternalStore`), so a runtime-added plugin's `apis` register.

A per-plugin error boundary now contains a contribution that fails to load or render, so one bad (third-party) plugin degrades gracefully instead of crashing the shell.

Bundle effect: heavy extension components (dashboard, anomaly IDE panels, dependency editor, healthcheck system overview) leave the initial load. The initial-load JS reduction is small on its own (the eager floor is shell-level shared vendor, not plugin code); the primary value is the hardened, future-proof contract for external plugins.
