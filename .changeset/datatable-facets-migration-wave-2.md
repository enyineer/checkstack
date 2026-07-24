---
"@checkstack/ui": minor
"@checkstack/catalog-frontend": patch
"@checkstack/healthcheck-frontend": patch
"@checkstack/ai-backend": patch
---

Migrate the catalog and health-check filters onto the shared filter bar

Completes the consolidation. Every faceted list surface now renders one control
set over one state model.

`@checkstack/ui` gains what those two surfaces genuinely needed:

- `DataTableFacetControl` splits the PRESENTATIONAL half of a facet from its row
  accessor. The catalog's matching cannot be a `value(row): string` - a system
  belongs to several groups and carries several tags, its health lives in a
  separate status map, and the same three controls also narrow GROUPS, a
  different row type entirely. Such a surface can now use the shared bar and keep
  its own matching, instead of being shut out or supplying fake accessors.
- `disabled` / `disabledReason` keep a control visibly present-but-unavailable
  (the catalog's health filter before a health source is installed). Preferred to
  dropping the control: present-but-disabled says the capability exists and what
  would unlock it. It also keeps the parameter declared, so a selection arriving
  on a shared link still constrains rather than silently widening the list.
- A facet option may carry a `tone`, applied while that option is selected. This
  is reserved for a dimension that genuinely IS a status: the health-check run
  filter's green "Healthy" / red "Failing" is the product's vocabulary, and a
  shared control that could not express it would be a downgrade on the one
  surface where colour carries the most meaning. Tone never affects matching.

Migrated:

- **Catalog** - `CatalogBrowseToolbar` becomes a thin wrapper over the shared
  bar; the density toggle rides in its `children` slot, since it narrows nothing
  and as a facet would sit behind Clear, where "clear filters" would silently
  reset row height. One toolbar still drives the browse grid and all three manage
  tabs, and `GroupsTab`'s reorder arrows are still gated on the filtered state.
  Environments were filtered by an ad-hoc substring match in the page; they now
  go through the shared logic and match descriptions too.
- **Health checks** - the list toolbar (a self-declared copy of the catalog's)
  and both hand-rolled pill groups are deleted. The run-history filters gain URL
  persistence, so a filtered run view is now shareable, and both pill groups gain
  the `aria-pressed` and labelled group they were missing.

All existing URL parameters are preserved, guarded by tests, so links shared
before the migration still reopen the same view - including the catalog's
per-system "view health checks" link, whose server-side authorization path is
deliberately kept as a control without a row accessor.
