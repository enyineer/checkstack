---
"@checkstack/catalog-common": minor
"@checkstack/catalog-backend": minor
"@checkstack/catalog-frontend": minor
---

Persist a browse order for catalog groups.

Groups gained a `sortOrder` column and a new `reorderGroups` procedure, so the
order you arrange groups in is saved to the database and returned by
`getGroups()` instead of being an ephemeral client-side header sort. The Groups
management tab now has up/down reorder controls (disabled while a search filter
is active, since reordering a filtered subset is ambiguous). A forward-only
migration backfills a deterministic order (`row_number()` over `created_at, id`)
for pre-existing groups. `reorderGroups` is gated on the global
`catalog.group.manage` rule, consistent with the other group mutations.

Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.
