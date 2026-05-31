---
"@checkstack/slo-backend": minor
---

Make `slo` a plugin-backed, COMPUTED reactive entity via the Model-B entity state machine + rewire its cross-plugin consumers.

SLO defines a `slo` entity `{ objectiveId, systemId, target, budgetRemainingPercent, currentStreak, bestStreak }` keyed by `objectiveId`. There is no framework `entity_state` row: its current state is assembled on demand by a `read` accessor (`createSloEntityRead` / `computeSloEntityState`). `currentStreak` / `bestStreak` / `systemId` / `target` come from the authoritative `slo_streaks` + `slo_objectives` tables, and `budgetRemainingPercent` (plus `target`) is COMPUTED on the fly via the SLO engine's `computeStatus` (downtime aggregation over the objective's rolling window). The daily snapshot job's streak-persist write drives through the fail-soft `writeSloEntity` (`handle.mutate({ id: objectiveId, apply })`): `apply` persists the streak to `slo_streaks` (its own write) and returns the freshly-computed view; the framework snapshots `prev` via the computed `read` BEFORE the write, appends the transition log, and emits `ENTITY_CHANGED`.

Compute-on-read (not materialize): the budget is a pure function of the objective's append-only downtime history, so storing a second copy would duplicate the engine's source of truth and risk drift. The `read` recomputes from the same tables the SLO API already reads; it is only exercised on the prev-snapshot of the once-daily streak job and on reactive scope/wake resolution, so the recompute cost is negligible. The append-only `slo_downtime_events` + `slo_daily_snapshots` tables are declared non-reactive (bookkeeping); the live budget/streak is the entity. Operators author budget/streak thresholds as reactive `numeric_state` conditions over `state.slo.<objectiveId>.budgetRemainingPercent` / `currentStreak`.

The healthcheck + catalog consumers switched from `onHook(<hook>)` to `onEntityChanged({ kind })`, all keeping `work-queue` delivery (each handler performs side-effecting writes that must run once per cluster):
- `slo-system-down` / `slo-upstream-down`: react to `health` changes filtered to a degraded transition (`classifyHealthChange().degraded`).
- `slo-system-up`: reacts to `health` changes filtered to a recovered transition (`classifyHealthChange().recovered`).
- `slo-system-cleanup`: reacts to `catalog-system` tombstones (`change.next === null`).

BREAKING CHANGES:
- The `slo.budget.warning` / `slo.budget.critical` / `slo.budget.exhausted` and `slo.streak.broken` automation triggers are removed. These thresholds were never emitted by the engine (the underlying hooks were inert) and are replaced by reactive `numeric_state` conditions over the `slo` entity (`budgetRemainingPercent < 20`, `currentStreak == 0`, etc.). Re-author any automations that referenced these trigger ids as `numeric_state` / `state` conditions. The `slo.achievement.unlocked` and `slo.weekly.digest` triggers are KEPT.
