---
"@checkstack/healthcheck-backend": patch
"@checkstack/incident-backend": patch
"@checkstack/maintenance-backend": patch
"@checkstack/ai-backend": patch
"@checkstack/notification-backend": patch
"@checkstack/status-page-backend": patch
"@checkstack/announcement-backend": patch
"@checkstack/gitops-backend": patch
---

Batch hot-path scoped-db reads/writes into single transactions to cut per-query round-trips.

The scoped-db proxy wraps every standalone query in its own `BEGIN → SET LOCAL search_path → query → COMMIT`, so a path issuing N sequential queries paid N round-trips and checked out a connection N times. These reads/writes now run under one `withScopedTransaction`, collapsing the batch to a single `SET LOCAL` on one connection. Behavior is unchanged:

- healthcheck: `getSystemHealthOverview`'s `1 + N·(2+E)` read fan-out.
- incident/maintenance: `getIncident`/`getMaintenance` (4 reads), `getManyEntityStates`, `listOpenIncidentsBySystem` / `getActiveMaintenancesBySystem`, `getMaintenanceWindowsForRange`; the `list*` / `*ForSystem` per-row `N+1` system lookups collapsed to a single set-based `inArray` read; maintenance `transitionStatus` update+insert made atomic; `addUpdate`/`editUpdate`/`addLink` use `.returning()` instead of a follow-up re-select.
- ai: `appendMessage`, memory `saveOrUpdate`.
- notification: `resolveInheritedGroups`.
- status-page: subscriber `verify` (4 reads) and `unsubscribe` (3 reads).
- announcement: `getActiveAnnouncements` / `dismissAnnouncement` / `createAnnouncement`.
- gitops: `upsertProvenance`.
