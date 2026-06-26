---
"@checkstack/catalog-common": minor
"@checkstack/catalog-backend": minor
---

fix(catalog): emit a realtime signal on catalog mutations so clients refresh

Catalog was the only domain plugin that never broadcast a realtime signal, so
any out-of-band write - the AI assistant (which mutates on the backend, with no
frontend mutation to invalidate), GitOps reconcile, or another pod/user - left
every other client's catalog cache stale until a hard reload. Most visibly, a
system created via the assistant 404'd on the catalog detail page (which
resolves a system by finding it in the cached `getSystems` list) until reload.

Add a `CATALOG_CHANGED` signal (`catalog.changed`) and broadcast it from every
catalog mutation (system, group, environment CRUD and membership changes). The
frontend signal auto-invalidator refreshes the `[[catalog]]` react-query cache
on every connected client, so out-of-band catalog changes now appear without a
reload.
