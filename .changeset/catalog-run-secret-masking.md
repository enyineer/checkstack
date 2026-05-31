---
"@checkstack/catalog-backend": minor
---

Close a run-secret masking gap on run-originated catalog entity writes (security).

`writeCatalogSystemEntity` / `writeCatalogGroupEntity` had no `opts` parameter, so the `system.update_metadata` automation action (which has the dispatch `runId` in scope) could not forward it. Catalog `metadata` is `z.record(z.string(), z.unknown())` — the only reactive catalog field that can carry an arbitrary secret string — so a run-resolved secret merged into metadata would land UNMASKED in both the `entity_transitions` rows and the cluster-wide `ENTITY_CHANGED` event.

The catalog entity writers now accept `opts?: EntityMutationOpts` and forward it into `handle.mutate` / `handle.remove` (mirroring maintenance/slo), and `system.update_metadata` passes `opts: { runId }`. Run-resolved secrets in metadata are now masked in both the emit and the transition rows.
