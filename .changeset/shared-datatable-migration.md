---
"@checkstack/catalog-frontend": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/auth-frontend": minor
"@checkstack/incident-frontend": minor
"@checkstack/maintenance-frontend": minor
"@checkstack/slo-frontend": minor
"@checkstack/gitops-frontend": minor
"@checkstack/about-frontend": minor
"@checkstack/api-docs-frontend": minor
"@checkstack/pluginmanager-frontend": minor
"@checkstack/satellite-frontend": minor
"@checkstack/cache-frontend": minor
"@checkstack/queue-frontend": minor
"@checkstack/notification-frontend": minor
"@checkstack/automation-frontend": minor
"@checkstack/integration-frontend": minor
"@checkstack/announcement-frontend": minor
"@checkstack/infrastructure-frontend": minor
---

Migrate every list table to the shared `DataTable`, so columns can now be
sorted by clicking their headers (name, status, severity, timestamps, counts,
...) and tables that had no search gain a global search box. Tables render on
an opaque `bg-card` surface, fixing the previously transparent, hard-to-read
tables (e.g. Catalog Management). Existing per-page filters, bulk selection,
access gating, extension slots, provenance locks, row-click drawers, and
mobile card layouts are preserved. Incident/maintenance severity and status
sort by impact rank (most urgent first), not alphabetically. Server-paginated
tables keep server-side ordering and do not add a misleading page-local search.

Row action buttons are now standardized on the shared `RowActions`/`RowAction`
primitive, so every table's edit/delete/etc. look identical (a subtle ghost
icon button; destructive tinted red, confirmatory tinted green, never a loud
filled button). Redundant section headings that merely echoed the page title on
single-table pages (Incidents, Maintenances, SLO Objectives, Installed Plugins,
Satellite Nodes) were removed. The Infrastructure Settings tab rail gained an
accessible `Infrastructure settings` navigation label so its tab buttons stay
distinguishable from the new sortable column-header buttons in each tab's table.
