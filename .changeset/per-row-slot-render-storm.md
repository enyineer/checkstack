---
"@checkstack/frontend-api": minor
"@checkstack/auth-frontend": patch
---

Fix the catalog manage page render storm: with many visible systems, every
parent render (typing in the filter, any query refresh, opening a dialog)
re-rendered every row's slot fillers - rows x fillers x auth/query hook trees
- profiling as a GC-dominated main thread.

- `ExtensionSlot` now renders each extension through a memoized component
  that bails out on SHALLOW slot-context equality (`slotContextEquals`,
  regression-tested): inline context objects keep working, but an unchanged
  row no longer re-runs its fillers. Call sites must keep context VALUES
  referentially stable - primitives are free, memoize arrays/objects (the
  catalog already memoizes `visibleSystemIds`).
- `useCanAccessType`/`useSurfaceAccess` (`useTypeSurface`) now resolve the
  global rule and the authenticated gate from ONE `useAccessRules` call
  instead of two, halving the session/rules query observers each gated
  control allocates - noticeable when the gate is mounted once per row.
