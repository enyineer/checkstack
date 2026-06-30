---
"@checkstack/maintenance-frontend": minor
"@checkstack/dashboard-frontend": minor
"@checkstack/frontend-api": minor
"@checkstack/ui": minor
"@checkstack/announcement-frontend": minor
"@checkstack/frontend": patch
---

Surface scheduled (upcoming) maintenances on the dashboard.

The dashboard now shows a "Planned maintenances" section listing the soonest
scheduled maintenance windows (not yet started), each deep-linking to its
detail page. Previously scheduled windows were invisible on the dashboard until
they went live - operators had no at-a-glance view of upcoming planned work.

Only `scheduled` windows are listed. In-progress windows continue to surface as
per-system signals via the existing signals filler; showing them here too would
duplicate. The section renders nothing when there are no upcoming windows, so
the dashboard stays calm.

Dashboard sections are now registered as individual `DashboardSlot` extensions
with a `priority` metadata field, rendered sorted ascending. This replaces the
single monolithic `dashboard-main` extension and lets plugins position their
dashboard contributions relative to the platform-owned sections without a fixed
slot per position. Priority layout:

- 0: Welcome banner + getting-started checklist + queue-lag alert
- 5: Active announcements
- 10: System health overview
- 20: Planned maintenances (new)
- 30: Recent activity feed

`SectionHeader` now accepts an optional `actions` prop for right-aligned
controls, and both "System health" and "Planned maintenances" use it for
consistent header styling.
