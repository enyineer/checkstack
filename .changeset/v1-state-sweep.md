---
"@checkstack/announcement-frontend": patch
"@checkstack/healthcheck-frontend": patch
"@checkstack/incident-frontend": patch
"@checkstack/maintenance-frontend": patch
"@checkstack/notification-frontend": patch
"@checkstack/satellite-frontend": patch
"@checkstack/slo-frontend": patch
---

Standardise the empty / loading / error story on key list pages using
the shared `ListEmptyState`, `QueryErrorState`, and `Skeleton`
primitives from `@checkstack/ui`. Each affected page now branches
through the same `isLoading -> isError -> empty -> data` ladder, so
failed queries surface a retry-able inline error instead of silently
rendering an empty table, and loading states match the final layout
rather than flashing a generic spinner. No layout, business logic, or
query input shapes changed.
