---
"@checkstack/announcement-frontend": patch
"@checkstack/anomaly-frontend": patch
"@checkstack/cache-frontend": patch
"@checkstack/catalog-frontend": patch
"@checkstack/dashboard-frontend": patch
"@checkstack/dependency-frontend": patch
"@checkstack/gitops-frontend": patch
"@checkstack/healthcheck-frontend": patch
"@checkstack/incident-frontend": patch
"@checkstack/integration-frontend": patch
"@checkstack/maintenance-frontend": patch
"@checkstack/notification-frontend": patch
"@checkstack/queue-frontend": patch
"@checkstack/slo-frontend": patch
---

Gate decorative motion and blur effects behind
`usePerformance().isLowPower` on a focused set of high-traffic plugin
pages (Dashboard, Dependency map, System node, Notification bell,
Announcement banner / cards, Anomaly field overrides editor, SLO
attribution chart, Catalog droppable group). Hover scales, backdrop
blurs, `animate-pulse`/`animate-ping` accents, and entry transitions
now drop to static states on low-power devices; functional UX
transitions (Drawer/Dialog open-close, colour transitions) are left
alone.

Standardise the post-mutation error-toast voice on plugin pages by
migrating multi-clause `toast.error(extractErrorMessage(error, "Failed
to X"))` call sites onto the `toastError(toast, "Failed to X", error)`
helper from `@checkstack/ui`. The helper applies the canonical
`"action: message"` prefix and 100-character truncation in one place,
and the now-orphaned `extractErrorMessage` imports are dropped from
the affected files. No business logic or component APIs changed.
