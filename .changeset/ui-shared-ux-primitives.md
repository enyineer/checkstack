---
"@checkstack/ui": minor
---

Add four shared UX primitives to `@checkstack/ui`.

- `Breadcrumb`: an accessible breadcrumb trail (`<nav aria-label="Breadcrumb">`
  + ordered list, current page marked `aria-current="page"`). `PageHeader` and
  `PageLayout` gain optional `breadcrumbs` (and `onBreadcrumbNavigate`) props
  that render it above the title; existing pages are unaffected (opt-in).
- `CopyableValue`: a value plus copy button with toast feedback, an optional
  `shownOnce` warning style, and auto-select-on-mount for keyboard copy.
  Generalises the duplicated secret/DNS-record copy patterns.
- `useUnsavedChanges`: a dirty-form guard that installs a `beforeunload`
  listener and intercepts in-app navigations via react-router's `useBlocker`,
  exposing `isBlocked` / `confirmDiscard()` / `cancelDiscard()`.
- `useKeptPrevious`: keeps the previously-rendered list during a refetch to
  avoid layout jump and reports `isStale` for dimming.
