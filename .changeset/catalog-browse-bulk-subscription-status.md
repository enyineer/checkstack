---
"@checkstack/notification-frontend": patch
---

Catalog browse view: bulk-fetch notification subscription status for all visible
bells in one request instead of one per bell (performance-only, collapsed-trigger
behavior unchanged).

Every system row and group header on the catalog browse view mounts a
notification bell, and each collapsed bell previously issued its own
`getMySubscriptionStatus` request for its resource's primary group ids - an N+1
fan-out across the whole list. A new eager filler on catalog's
`CatalogBrowseDataBoundarySlot` (`BulkSubscriptionStatusProvider`) now wraps the
browse tree, computes the union of every visible resource's primary group ids
(from the registered specs and the `catalogSystemTarget` / `catalogGroupTarget`
resource keys), and fetches all of them in ONE request. Each collapsed bell reads
its subscribed state from that shared context and fires no request of its own.

The open-dialog path is unchanged: when the dialog is open (or no provider is
mounted, e.g. the single-resource system-detail bell), each bell keeps its own
per-bell query, its inheritance-augmented status batch, and all subscribe /
unsubscribe behavior. The collapsed trigger's rendered state
(subscribed / partial / none) is identical - only the data source changes.
