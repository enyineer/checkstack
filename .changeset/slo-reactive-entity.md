---
"@checkstack/slo-backend": minor
---

Migrate SLO to the reactive `slo` entity + rewire its cross-plugin consumers (reactive automation engine Phase 4, §10.7, §9.2).

SLO now defines a `slo` entity `{ objectiveId, systemId, target, budgetRemainingPercent, currentStreak, bestStreak }` keyed by `objectiveId` through the `automation.entity` extension point and mirrors the recomputed budget + streak into it from the daily snapshot job. Operators author budget/streak thresholds as reactive `numeric_state` conditions over `state.slo.<objectiveId>.budgetRemainingPercent` / `currentStreak`. The append-only `slo_downtime_events` + `slo_daily_snapshots` tables are declared non-reactive (bookkeeping); the live budget/streak is the entity.

The healthcheck + catalog consumers switched from `onHook(<hook>)` to `onEntityChanged({ kind })`:
- `slo-system-down` / `slo-upstream-down`: react to `health` entity changes filtered to a degraded transition (`classifyHealthChange().degraded`), reproducing the old `systemDegraded` predicate. Delivery stays `work-queue` (open/split downtime events must run once per cluster).
- `slo-system-up`: reacts to `health` changes filtered to a recovered transition (`classifyHealthChange().recovered`), reproducing the old `systemHealthy` predicate. Delivery stays `work-queue`.
- `slo-system-cleanup`: reacts to `catalog-system` tombstones (`change.next === null`), reproducing the old `system.deleted` cleanup. Delivery stays `work-queue`.

Each consumer keeps `work-queue` (not `broadcast`) because its handler performs side-effecting writes (open/close downtime, evaluate achievements, delete objectives/achievements) that must run exactly once per change across the cluster.

BREAKING CHANGES:
- The `slo.budget.warning` / `slo.budget.critical` / `slo.budget.exhausted` and `slo.streak.broken` automation triggers are removed. These thresholds were never emitted by the engine (the underlying hooks were inert) and are replaced by reactive `numeric_state` conditions over the `slo` entity (`budgetRemainingPercent < 20`, `currentStreak == 0`, etc.). Re-author any automations that referenced these trigger ids as `numeric_state` / `state` conditions. The `slo.achievement.unlocked` and `slo.weekly.digest` triggers are KEPT.
