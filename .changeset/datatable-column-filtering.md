---
"@checkstack/ui": minor
"@checkstack/announcement-frontend": patch
"@checkstack/ai-backend": patch
---

Make filtering part of the column contract

Filtering now joins sorting and searching on `DataTableColumn`: providing
`filterValue` is what makes a column filterable, with no separate boolean flag,
exactly as `sortValue` makes it sortable.

A status column already reads the row for `sortValue` and renders it in `cell`;
declaring the filter there too means the value is stated ONCE, so the badge, the
sort and the filter cannot drift apart. Previously the same value had to be
repeated in a standalone facet.

```tsx
{
  id: "severity",
  header: "Severity",
  cell: (a) => <SeverityBadge severity={a.severity} />,
  sortValue: (a) => severityRank[a.severity],
  filterValue: (a) => a.severity,
  filterOptions: SEVERITY_OPTIONS,  // omit to derive from the data
}
```

`filterOptions` is optional: omitted, the options are derived from the distinct
values present in the data, sorted and labelled by the raw value. Declare them
when the raw values are not what a person should read, when the order carries
meaning (severity by impact, which deriving would sort alphabetically into
critical / info / warning), or when an option must stay on offer even though no
row currently has it.

Options are derived from the FULL row set, never from what is currently visible.
Reading them off the filtered rows would let selecting one option delete every
other option, leaving no way back - the same reason a cell cannot simply publish
its value upward: rows excluded by a filter never render.

The standalone `facets` prop keeps its place for a dimension no single column
owns - the catalog's group and tag filters match several values per row and
narrow two different row types. Column-derived facets render first, in column
order, followed by those.

The announcements table is converted: its severity, status and visibility
filters now live on the columns that display them.
