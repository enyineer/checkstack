---
"@checkstack/ui": minor
"@checkstack/automation-frontend": patch
"@checkstack/catalog-frontend": patch
"@checkstack/healthcheck-frontend": patch
"@checkstack/logstream-frontend": patch
"@checkstack/metricstream-frontend": patch
"@checkstack/auth-frontend": patch
"@checkstack/script-packages-frontend": patch
---

Migrate the automation surfaces onto the shared filter bar, and dedupe useDebouncedValue

Follows the native `DataTable` facet API with the first wave of migrations.

- `DataTableFacet` gains `kind: "select" | "pills"`. A segmented pill row is the
  right control for two or three short options a reader benefits from seeing at
  a glance, and several surfaces had independently built one - so the shared bar
  renders that variant rather than forcing every list into a dropdown. Both
  variants share one state, sentinel and URL round-trip, and the pills set
  `aria-pressed`, which two of the hand-rolled groups they replace had omitted.
- `parsedFacetValue` reads a facet's selection back as a domain value by parsing
  it against the schema that defines it. Facet state is stringly-typed because
  it round-trips through the URL, but a server-side filter needs the narrow union
  its query input declares; parsing rather than casting means a stale link
  degrades to unconstrained instead of smuggling an unknown value into a request.
- The automation list and run-history pages drop their hand-rolled status pill
  rows for the shared bar. Their filters now persist to the URL, so a link to
  "the failed runs of this automation" reopens filtered. The run-history table
  also gains the `surface={false}` it was missing, fixing a panel-in-panel.
- `useDebouncedValue` had been copied verbatim into six plugin packages, each
  with a comment noting no shared version existed. All six now import the one in
  `@checkstack/ui` and the copies are deleted.
