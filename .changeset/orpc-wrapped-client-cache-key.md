---
"@checkstack/frontend-api": patch
---

Fix a `usePluginClient` wrapped-client cache miss that rebuilt every plugin's
hook wrappers per component instance. The cache was keyed on
`pluginUtils = orpcUtils[pluginId]`, but indexing the oRPC `RouterUtils` proxy
can return a fresh object each render, so gate-heavy pages (e.g. the catalog
manager, where every system row mounts several auth-gated badges/actions) missed
the cache and reallocated the whole wrapper (the AuthApi contract alone is ~80
procedures) per row - a real main-thread GC storm on navigation. The cache is now
keyed on the stable memoized `orpcUtils` root, so each plugin's wrapper is built
once app-wide and shared by every instance.
