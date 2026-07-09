---
"@checkstack/frontend-api": patch
---

perf(frontend-api): share the wrapped plugin client across component instances

`usePluginClient` memoized `wrapPluginUtils` per component instance only.
`wrapPluginUtils` walks a plugin's ENTIRE contract and allocates a hook-wrapper
closure per procedure (the AuthApi contract alone is ~80), so a page that gates
many rows on auth - the catalog manager, where every system row mounts several
auth-gated badges/actions (each calling `usePluginClient(AuthApi)` via
`useResourceAccess`/`useAccess`/`useProcedureAccess`) - rebuilt the whole wrapper
once PER ROW on navigation: hundreds of throwaway closures and a main-thread GC
storm (visible in a profile as `updateMemo` hot under every gating hook, ~half
its time in GC/CC).

The wrappers are render-agnostic - their methods call React hooks at CALL time
and close over only stable values - so the wrapped object is a pure function of
`(pluginUtils, contract)` and safe to build ONCE and share. It is now cached in
a module-level WeakMap keyed on the stable `pluginUtils` (with the contract as a
second key), so it is built once per plugin and reused by every caller, and the
whole cache falls away automatically when the provider re-creates its rpc client.
This collapses navigation cost from O(instances x procedures) to
O(plugins x procedures).
