---
"@checkstack/frontend": patch
"@checkstack/frontend-api": patch
---

Give failed plugin pages and shell render errors a real, actionable fallback.

A plugin page that throws or fails to code-split previously fell back to a bare
line of text ("This page failed to load. Try reloading."), and
`PluginErrorBoundary`'s default fallback was an invisible `null`, so a broken
slot extension simply vanished.

- The route-level error fallback in `@checkstack/frontend` is now a real
  `error`-variant card (icon + message + a "Reload page" button) that mirrors
  the look of `@checkstack/ui`'s `QueryErrorState`. It reloads the page rather
  than retrying a single query, since a failed module/render can't be retried in
  place.
- Added a top-level `ShellErrorBoundary` around the app so a render error
  OUTSIDE a plugin contribution (in the chrome, a slot, or a provider) degrades
  to the same friendly, reloadable fallback instead of white-screening.
- `LazyContribution`'s `PluginErrorBoundary` now renders a small, visible
  "this section failed to load" notice with a reload action as its default,
  instead of invisible `null`, so contributions without an explicit
  `errorFallback` degrade visibly. The default stays framework-agnostic so
  `frontend-api` keeps no dependency on `@checkstack/ui`.
