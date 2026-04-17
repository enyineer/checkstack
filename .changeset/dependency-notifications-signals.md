---
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-frontend": patch
"@checkstack/dashboard-frontend": patch
"@checkstack/maintenance-frontend": patch
"@checkstack/incident-frontend": patch
---

Add SYSTEM_STATUS_CHANGED signal and dependency-driven notification improvements

**healthcheck-common:**

- New `SYSTEM_STATUS_CHANGED` signal that fires only on system-level health status transitions (healthy ↔ degraded ↔ unhealthy), providing a low-noise alternative to `HEALTH_CHECK_RUN_COMPLETED` for coarse-grained reactivity

**healthcheck-backend:**

- Broadcast `SYSTEM_STATUS_CHANGED` signal at both status transition code paths in the queue executor

**healthcheck-frontend:**

- Switch `SystemHealthBadge` from `HEALTH_CHECK_RUN_COMPLETED` to `SYSTEM_STATUS_CHANGED` to reduce unnecessary refetch noise

**dashboard-frontend:**

- Switch `SystemBadgeDataProvider` from `HEALTH_CHECK_RUN_COMPLETED` to `SYSTEM_STATUS_CHANGED` for more efficient badge updates

**maintenance-frontend:**

- Clarify that notification suppression toggle also applies to downstream dependency-driven notifications

**incident-frontend:**

- Clarify that notification suppression toggle also applies to downstream dependency-driven notifications
