---
"@checkstack/ui": patch
"@checkstack/incident-frontend": patch
"@checkstack/maintenance-frontend": patch
"@checkstack/automation-frontend": patch
"@checkstack/healthcheck-frontend": patch
"@checkstack/ai-backend": patch
---

Move every table's filters into the table itself

The earlier migration unified how filter controls are BUILT but left several
rendering above their table as a detached bar, justified by the filtering
running server-side. That justification was wrong: where the narrowing runs says
nothing about where the control belongs, and a bar floating above a card reads
as unrelated to the list under it.

Now in the table's own bar:

- **Incidents** and **maintenances** - the Status column declares `filterValue`,
  so the control sits with the column it filters. The selection still narrows
  the list query, which is what actually reduces the fetch; the column filter
  re-applying it over already-scoped rows is a harmless no-op.
- **Automation run history** - same, with the status pills.
- **Health-check list** - search, strategy and status move onto their columns.
  The assigned-system control has no row to read (selecting a system swaps the
  data source, which is what makes the catalog's per-system link work without
  health-check grants), so it rides in as a control-only facet.
- **Health-check drawer** - the run-status control moves into the runs table.

`DataTable`'s `facets` now accepts a control WITHOUT a row accessor, rendered but
not applied. That is what lets a server-applied dimension stay in the table's bar
instead of forcing a second bar onto the page.

Fixes a trap the move exposed: with server-side filtering an empty `data` means
either "none exist" or "none match", and three of these pages rendered their
onboarding empty state either way - automation's run history replaced the whole
table, taking the filter controls with it, so a filter matching nothing could not
be cleared. Each now suppresses its `emptyState` while a filter is active and
offers a "no matches, clear filters" state instead.

Three surfaces deliberately keep an external bar, each narrowing more than one
list: the catalog toolbar (a browse grid plus three manage tabs), the automation
list (one table per accordion group), and the health-check drawer's source
control (it scopes the charts as well as the runs). The history detail page's
list is not a `DataTable` at all.
