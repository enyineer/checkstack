---
"@checkstack/frontend": minor
"@checkstack/frontend-api": minor
"@checkstack/ui": minor
"@checkstack/scripts": minor
"@checkstack/about-frontend": patch
"@checkstack/ai-frontend": patch
"@checkstack/announcement-frontend": patch
"@checkstack/anomaly-frontend": patch
"@checkstack/api-docs-frontend": patch
"@checkstack/auth-frontend": patch
"@checkstack/automation-frontend": patch
"@checkstack/cache-frontend": patch
"@checkstack/catalog-frontend": patch
"@checkstack/command-frontend": patch
"@checkstack/dashboard-frontend": patch
"@checkstack/dependency-frontend": patch
"@checkstack/gitops-frontend": patch
"@checkstack/healthcheck-frontend": patch
"@checkstack/incident-frontend": patch
"@checkstack/infrastructure-common": patch
"@checkstack/infrastructure-frontend": patch
"@checkstack/integration-frontend": patch
"@checkstack/maintenance-frontend": patch
"@checkstack/notification-frontend": patch
"@checkstack/pluginmanager-frontend": patch
"@checkstack/queue-frontend": patch
"@checkstack/satellite-frontend": patch
"@checkstack/script-packages-frontend": patch
"@checkstack/secrets-frontend": patch
"@checkstack/signal-frontend": patch
"@checkstack/slo-frontend": patch
"@checkstack/test-utils-frontend": patch
"@checkstack/theme-frontend": patch
"@checkstack/tips-frontend": patch
---

Upgrade React 18 to React 19 across the platform.

**BREAKING (runtime frontend plugins):** React is shared as a Module Federation
singleton, so the host now provides **React 19** to every runtime plugin.
Frontend plugins built against React 18 must be rebuilt against React 19
(`react` / `react-dom` `^19`). The scaffold templates and the host/plugin MF
`requiredVersion` are updated to `^19`. `react` (and now `react-dom`) are pinned
to a single version across the workspace via syncpack so the singleton can never
skew (react and react-dom must match exactly).

The React 19 removed-API surface was audited - the codebase used only no-arg
`useRef()` (now `useRef<T | undefined>(undefined)`); no `ReactDOM.render`,
legacy context, string refs, or function-component `defaultProps`. This also
clears the `IMPORT_IS_UNDEFINED` build warnings for `React.use` /
`React.useOptimistic` (react-router 7 feature-detection), which React 19 exports.

The downstream `*-frontend` packages (and `@checkstack/infrastructure-common`)
receive only the mechanical `react` dependency bump (`patch`); the framework
packages carrying the shared-singleton change are bumped `minor`.
