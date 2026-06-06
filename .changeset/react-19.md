---
"@checkstack/frontend": minor
"@checkstack/frontend-api": minor
"@checkstack/ui": minor
"@checkstack/scripts": minor
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
