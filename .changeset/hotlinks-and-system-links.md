---
"@checkstack/incident-common": minor
"@checkstack/incident-backend": minor
"@checkstack/incident-frontend": minor
"@checkstack/maintenance-common": minor
"@checkstack/maintenance-backend": minor
"@checkstack/maintenance-frontend": minor
"@checkstack/catalog-common": minor
"@checkstack/catalog-backend": minor
"@checkstack/catalog-frontend": minor
"@checkstack/ui": minor
---

feat: hotlinks on incidents/maintenances and additional links on systems

Users with `manage` access on an incident, maintenance, or system can now
attach free-form URL "hotlinks" — Jira tickets, runbooks, dashboards, ticket
tools, etc. — alongside the existing fields.

- **Incidents** & **maintenances**: links live on the entity itself and are
  surfaced both in the editor dialog and on the public detail page. Two new
  RPC procedures per plugin (`addLink`, `removeLink`) gated behind the
  existing `manage` access rule. Links are returned as part of
  `getIncident` / `getMaintenance` and cache-invalidated on every link
  mutation.
- **Systems**: a parallel `system_links` table with `getSystemLinks`,
  `addSystemLink`, `removeSystemLink` procedures. Surfaced inside the
  system editor (next to contacts) and on the read-only system detail
  sidebar. Cache-scoped per-system so list endpoints remain hot.
- **Shared UI**: a `LinksEditor` component in `@checkstack/ui` does the
  presentation; the three plugins each own their own RPC wiring.

Database changes ship as additive migrations (new `incident_links`,
`maintenance_links`, `system_links` tables, all FK-cascaded on parent
delete). No existing columns or rows are touched.

The system incident and maintenance history pages now sort by relevance:
active entries (non-`resolved` incidents, `scheduled` or `in_progress`
maintenances) appear at the top, with creation date descending as the
tiebreaker.
