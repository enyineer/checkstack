---
"@checkstack/dependency-backend": minor
"@checkstack/automation-backend": minor
---

Migrate dependency edges to the reactive `dependency-edge` entity + rewire cross-plugin consumers (reactive automation engine Phase 4, §10.5).

Dependency now defines a `dependency-edge` entity `{ sourceSystemId, targetSystemId, impactType, transitive }` keyed by dependency id through the `automation.entity` extension point and mirrors it at every mutation site (router `createDependency` / `updateDependency` / `deleteDependency`, plus the `dependency.create` / `dependency.remove` automation actions). A change → trigger-event deriver reproduces the existing `dependency.created` / `.updated` / `.deleted` qualified events so automations keep firing. The `dependency_derived_states` propagation cursor is declared non-reactive (bookkeeping).

The catalog + healthcheck consumers switched from `onHook(<hook>)` to `onEntityChanged({ kind })`, all keeping `work-queue` delivery (cleanup + downstream-propagation are side-effecting writes that must run once per cluster):
- `dependency-system-cleanup`: reacts to `catalog-system` tombstones (`change.next === null`).
- `dependency-notification-evaluator` / `-recovery`: react to `health` changes filtered to a degraded / recovered transition via `classifyHealthChange`, reproducing the old `systemDegraded` / `systemHealthy` predicates.

`@checkstack/automation-backend` adds `makeEntityDrivenTriggerSetup()` — a no-op `setup` factory so a migrated domain's lifecycle triggers stay in the editor's trigger catalog (and register cleanly) while being fired by the entity change deriver via Stage-1 routing rather than a hook.

BREAKING CHANGES:
- The `dependency.created` / `dependency.updated` / `dependency.deleted` cross-plugin hooks (the `createHook` descriptors) are removed. Dependency lifecycle is now the reactive `dependency-edge` entity; the matching trigger events still fire (via the entity change deriver), so existing automations on `dependency.created/.updated/.deleted` keep working. The `dependency.impact_propagated` hook is KEPT (a derived fan-out signal, not a single mutable field). No in-repo plugin subscribed to the removed hooks.
