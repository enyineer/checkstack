---
"@checkstack/status-page-backend": minor
"@checkstack/status-page-common": minor
"@checkstack/status-page-frontend": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-common": minor
"@checkstack/incident-backend": minor
"@checkstack/maintenance-backend": minor
---

Status pages can now publish only a subset of catalog environments. The page
builder gains a "Published environments" picker (empty = all environments, the
backward-compatible default). When a non-empty set is selected, the page omits
status, incidents, maintenances and uptime for systems that belong to none of
the selected environments.

- Status pages store an optional `publishedEnvironmentIds` set (new nullable
  `published_environment_ids` column; NULL = all environments, so existing pages
  are unchanged) exposed on `StatusPage`, `createStatusPage`, and
  `updateStatusPage`.
- The scope is threaded onto `WidgetResolveContext.publishedEnvironmentIds` as
  opaque strings and passed identically to `resolvePublic`,
  `resolveScopedSystems`, and `resolveScopedSystemsDetailed` (and the email
  subscribe clamp + fan-out), so what a page shows, offers for subscription, and
  emails about all agree.
- Health widgets recompute per environment: they read the per-environment health
  matrix and roll up only the selected environments. `getBulkRunStats` and
  `getRunStats` gain an optional `environmentIds` filter so uptime counts only
  runs recorded in the selected environments.
- Incident and maintenance widgets filter their feed and scope by intersecting
  each item's affected systems with the environment-visible systems. Incidents
  and maintenance windows carry no environment of their own, so a system in
  several environments makes its items visible on a page publishing ANY of them
  (the multi-environment caveat).
