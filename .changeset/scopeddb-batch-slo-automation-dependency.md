---
"@checkstack/slo-backend": patch
"@checkstack/automation-backend": patch
"@checkstack/dependency-backend": patch
---

Batch scoped-db query round-trips on hot write/store paths. Each standalone
scoped-db query pays its own `BEGIN → SET LOCAL search_path → COMMIT`; these
sites now run their sequential queries under a single `withScopedTransaction`
(or fold a reload into `.returning()`, or collapse an N-row insert loop into
one multi-row insert), cutting connection churn and round-trips with identical
persisted results:

- slo-backend: `openDowntimeEvent` (insert+reload → `INSERT ... RETURNING`),
  `closeDowntimeEvent` and `updateObjective` (select+update+reload → one
  transaction with `UPDATE ... RETURNING`).
- automation-backend: `WindowStore.recordAndCount` (insert+count) and
  `DwellStore.arm` (select+insert+reselect) each wrapped in one transaction;
  `resolveConsumedArtifacts` N+1 artifact lookups collapsed into a single
  `inArray` query via a new `ArtifactStore.findLatestByTypes`.
- dependency-backend: `createDependency` / `updateDependency` wrapped (cycle
  detection and the reload threaded through the transaction) with the per-rule
  insert loop collapsed into one multi-row insert; `saveNodePositions`
  delete+N-inserts collapsed into one wrapped delete + multi-row insert;
  `getDependencyById` and `deleteDependency` wrapped.
