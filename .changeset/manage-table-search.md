---
"@checkstack/incident-frontend": patch
"@checkstack/maintenance-frontend": patch
"@checkstack/automation-frontend": patch
---

Let you search the incident, maintenance and automation lists

These three management lists had their search box switched off, on the
assumption that you find a record by status rather than by typing its name. That
was wrong: every one of them shows a title or name column, and none of the
underlying queries paginate, so the full set is already in the browser and there
was nothing to gain by withholding search.

- **Incidents** gain a search box and a **severity filter**. Severity had a
  column and a sort but no filter, so "show me the criticals" needed reading the
  whole table. Its options are ordered by impact, matching how the column sorts;
  deriving them would have sorted alphabetically as critical / major / minor.
- **Maintenances** gain a search box.
- **Automations** gain a search box. It is page-level rather than table-level
  because that list renders one table per group - a table-owned box would only
  ever search its own group, so a match inside a collapsed group could never
  surface. Filtering ahead of the grouping also makes groups with no match
  disappear instead of leaving a wall of empty accordions.

All three searches match the title/name AND the second line the row renders (a
description, or the group label), so a search matches the words you can actually
see on the row.
