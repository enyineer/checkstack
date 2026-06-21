---
"@checkstack/dashboard-frontend": minor
"@checkstack/catalog-frontend": minor
"@checkstack/status-page-frontend": minor
---

Improve list-page feedback, loading, and formatting consistency.

The dashboard, catalog browse, and status-pages list pages now render an
explicit query-error state (`QueryErrorState` with a Retry button) when their
list query fails, instead of silently falling through to the empty state. The
error branch is additive: it only appears on a failed query, so the existing
empty-state copy and behavior are unchanged.

The dashboard system-health overview and the catalog browse list now show
layout-mimicking `Skeleton` placeholders while loading (instead of a centered
spinner), so the page no longer jumps when data resolves.

Toast call sites in catalog and status-page now route error and success
toasts through the shared `toastError` / `toastSuccess` helpers, giving error
toasts the canonical "{action}: {message}" voice with length truncation. The
public status-page uptime percentages now format through the shared
`formatPercent` helper (output-equivalent). The dashboard tip-banner lightbulb
accent uses the `text-warning` token instead of a hardcoded amber color.
