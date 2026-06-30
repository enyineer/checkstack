---
"@checkstack/ui": minor
"@checkstack/maintenance-frontend": minor
"@checkstack/incident-frontend": minor
"@checkstack/status-page-frontend": minor
---

Add a searchable, stably-sorted system picker to maintenance and incident editors.

The "Affected Systems" picker in the maintenance and incident editors was a
plain inline checkbox list that was neither sorted nor searchable, so the
order jumped between renders and finding a system in a large catalog meant
scrolling. Both now use a shared `SystemMultiSelect` component that sorts
systems by name (case-insensitive, natural numeric order) once per render and
adds a substring search box, with a "{n} selected" count.

`SystemMultiSelect` is now exported from `@checkstack/ui`. The status-page
builder's inline duplicate of the same component is removed in favour of the
shared one.
