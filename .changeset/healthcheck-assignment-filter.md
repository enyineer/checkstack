---
"@checkstack/healthcheck-frontend": minor
---

Add a filter input to the "Available" section of the system ↔ healthcheck
assignment editor.

The assignment IDE tree's "Available" list now has a search box that filters
assignable health checks by name or strategy-id tail (case-insensitive), with
an empty-state message when the filter yields no matches. The one-click-to-assign
interaction is unchanged.
