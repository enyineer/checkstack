---
"@checkstack/catalog-backend": patch
---

Batch the catalog backend's scoped-db read fan-outs and write groups into
single `withScopedTransaction` calls so each pays one
`BEGIN`/`SET LOCAL search_path`/`COMMIT` and holds one connection, instead of
issuing N standalone per-query transactions. No behavior change: the same
records, ordering, and output shapes are returned.

- `getEntities` now reads systems + groups (with their memberships) via one
  batched `getEntitiesTopology()` under a single transaction (was 3 standalone
  scoped queries from `getSystems()` + `getGroups()` back-to-back).
- `getGroups` batches its 2 reads (groups + all memberships) into one
  transaction.
- `createGroup` wraps the `max(sortOrder)` read and the insert in one
  transaction. Besides cutting a round-trip, this tightens the
  read-then-insert window: the max read and insert now run back-to-back on one
  connection with no await interleaving between them.
- `setSystemEnvironments` reads current membership, diffs, and applies the
  adds/removes inside one transaction, making the membership swap atomic (no
  partial state is observable) as well as batched.
- The environment read fan-outs (`getEnvironments`, `getEnvironment`,
  `getEnvironmentsByIds`, and the system-scoped resolution behind
  `getSystemEnvironments` / `resolveSystemEnvironments`) each run their 2-3
  reads under one transaction.
