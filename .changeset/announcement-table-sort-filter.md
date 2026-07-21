---
"@checkstack/announcement-frontend": minor
---

Make the announcement table sortable and filterable

Every column except Actions now sorts, and the list can be narrowed by title,
severity, status and visibility.

- **Sorting** is on impact rather than alphabet where that differs: severity
  sorts critical -> info, status sorts active -> scheduled -> expired ->
  inactive (the order the stat strip lists its buckets in), and Created sorts on
  the raw timestamp instead of the "3 days ago" prose the cell shows. The two
  icon-only columns sort by the label their tooltip shows.
- **Filtering** adds a title search plus severity / status / visibility facets,
  a Clear affordance, and a filtered-empty state. Values arriving from the
  `<Select>`s are parsed against the schemas that define them, so an
  unrecognised value degrades to "unconstrained" rather than becoming a filter
  nothing can match. The Status facet matches on the DERIVED lifecycle state, so
  it stays correct as an announcement's window opens and closes.
- **Reordering** moved out of the Actions cluster into its own sortable "Order"
  column that also shows each announcement's 1-based position. The position is
  what makes the up/down arrows legible while the table is sorted some other
  way. While a filter actually hides rows the arrows are disabled with a "Clear
  filters to reorder" tooltip, since the neighbour being swapped with would be
  off-screen - the same rule the catalog's Groups tab uses.

The table previously declared itself deliberately unsortable, on the grounds
that sorting would desync the index-based reorder controls from the visible row
order. Showing each row's canonical position removes that constraint.

Also fixes a pre-existing panel-in-panel: the table paints its own bordered
surface inside an already-opaque Card, so it now passes `surface={false}` like
the automation list and queue panels do.
