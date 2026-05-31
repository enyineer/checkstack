---
"@checkstack/slo-backend": minor
---

Reconvert `slo` to a Model-B PLUGIN-BACKED, COMPUTED reactive entity.

The `slo` entity no longer mirrors into a framework `entity_state` row. Its
current state is assembled on demand by a `read` accessor: `currentStreak` /
`bestStreak` / `systemId` / `target` come from the authoritative `slo_streaks`
+ `slo_objectives` tables, and `budgetRemainingPercent` (plus `target`) is
COMPUTED on the fly via the SLO engine's `computeStatus` (downtime aggregation
over the objective's rolling window). The daily snapshot job's streak-persist
write now drives through `handle.mutate({ id: objectiveId, apply })` — `apply`
persists the streak to `slo_streaks` (its own write) and returns the
freshly-computed view; the framework snapshots `prev` via the computed `read`
BEFORE the write, appends the transition log, and emits `ENTITY_CHANGED`.

Compute-on-read (not materialize): the budget is a pure function of the
objective's append-only downtime history, so storing a second copy would
duplicate the engine's source of truth and risk drift. The `read` recomputes
from the same tables the SLO API already reads. The accessor is only exercised
on the prev-snapshot of the once-daily streak job and on reactive
scope/wake resolution, so the recompute cost is negligible.

Changes:

- New `createSloEntityRead` / `computeSloEntityState` assemble the
  `{ objectiveId, systemId, target, budgetRemainingPercent, currentStreak,
  bestStreak }` view per objective id (missing objectives omitted).
- `streak-calculator` routes the increment/reset streak write through the new
  fail-soft `writeSloEntity` (`handle.mutate`); the old `mirrorSloEntity`
  `handle.set` mirror is dropped.
- `defineEntity` now supplies the plugin `read` and drops the store-backed
  `system` expression index (an index over a non-existent `entity_state` row).
- UNCHANGED and behavior-preserving: the SLO change-deriver (still emits `[]`
  — thresholds are derived `numeric_state` conditions over `state.slo.*`), the
  `achievement.unlocked` + `weekly.digest` hooks, and every `onEntityChanged`
  consumer (slo reacting to `health` + `catalog-system`).

BREAKING CHANGE: the `slo` entity is now plugin-backed + computed. It no longer
has a framework `entity_state` row and the previously-declared `system`
expression index is removed (it indexed nothing once the state moved out of
`entity_state`). No automation-facing surface changes: the entity kind, state
shape, and condition surface (`state.slo.<objectiveId>.*`) are identical.
