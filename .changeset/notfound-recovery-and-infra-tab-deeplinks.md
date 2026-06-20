---
"@checkstack/ui": patch
"@checkstack/infrastructure-frontend": patch
---

Add recovery actions to the 404 page and make infrastructure tabs deep-linkable.

The `NotFound` page now offers two secondary recovery actions alongside "Back
to Dashboard": a "Search" button that opens the global command palette (⌘K /
Ctrl+K) and a "Browse docs" link to the user guide. The playful falling-"4"
design is unchanged.

The Infrastructure Settings page now drives its active tab from a `?tab=<id>`
URL search param instead of local component state, so the selected tab
(Queue/Cache/…) is linkable, bookmarkable, and restored on reload. It falls
back to the first visible tab when the param is absent or invalid.
