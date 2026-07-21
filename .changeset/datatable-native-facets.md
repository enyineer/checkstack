---
"@checkstack/ui": minor
"@checkstack/announcement-frontend": patch
"@checkstack/ai-backend": patch
---

Add native facet filtering to DataTable, with URL-persisted state

Search and "narrow by status/severity/type" had no home in `DataTable`, which
owned only a free-text box whose query lived in internal state a page could not
observe. So every surface that needed to know what was filtered - to gate a
control, to render its own empty state, to put the view in a shareable link -
abandoned the built-in search entirely and hand-rolled the lot. Across the repo
that produced 18 surfaces rendering filter UI outside `DataTable` against 17
using only its built-in search, with six different renderings of the same select
and three different "show everything" sentinels.

`DataTable` now accepts:

- `facets` - declarative `{ id, label, options, value }` filters rendered beside
  the search box, ANDed with each other and with the search, with a Clear
  affordance and a `noResultsState` that fires on facet emptiness.
- `filters` / `onFiltersChange` / `onClearFilters` - the state is controllable,
  so a page can observe it. Omit them and the table owns it internally.
- `surface={false}` now also insets the filter bar with a separating rule, so a
  table nested full-bleed in a page's own Card no longer has its controls flush
  against the card's edges.

New exports:

- `useDataTableFilters` persists filter state to the URL, so a filtered view is
  shareable, survives a reload, and returns intact from a row's detail page. It
  exposes `active` (for gating controls a filtered view makes ambiguous) and a
  `debounced` variant for server-side query inputs, plus `paramPrefix` for two
  filtered tables on one page.
- `DataTableFilterBar` renders the same controls for a list surface that is not
  a table, so a card grid filters identically to one.
- `useDebouncedValue`, which had been copied verbatim into six plugin packages,
  each carrying a comment noting that no shared version existed.

The announcements manage table is migrated onto it as the first consumer,
dropping its local filter module in favour of facet declarations.
