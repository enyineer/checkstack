---
"@checkstack/dependency-backend": minor
"@checkstack/automation-backend": minor
---

Make `dependency-edge` a plugin-backed reactive entity via the Model-B entity state machine + rewire cross-plugin consumers.

Dependency defines a `dependency-edge` entity `{ sourceSystemId, targetSystemId, impactType, transitive }` keyed by dependency id. The `dependencies` table is BOTH authoritative AND the entity's current-state storage - there is no framework `entity_state` row for a dependency edge. `defineEntity` is given a plugin `read` accessor (`DependencyService.getManyEntityStates`) that projects the reactive subset straight off that table, and every reactive-state write goes through `handle.mutate` / `handle.remove`: `apply` performs the REAL `dependencies` write (the plugin's own db/tx, including the cycle/duplicate validation that may throw) and returns the new state; the framework snapshots `prev` via `read` BEFORE the write, appends the transition log, and emits `ENTITY_CHANGED` AFTER the write commits. Covered sites: create, update, delete (tombstone), plus the `dependency.create` / `dependency.remove` automation actions. Create sites pre-generate the id so the create's `prev` snapshot reads the not-yet-existing row as absent; `createDependency` accepts an optional pre-generated `id` (server-owned either way). The `dependency_derived_states` propagation cursor is declared non-reactive (bookkeeping).

A change -> trigger-event deriver reproduces the existing `dependency.created` / `.updated` / `.deleted` qualified events so automations keep firing. The old `dependency.created` / `.updated` / `.deleted` change hooks are removed; the catalog + healthcheck consumers switched from `onHook(<hook>)` to `onEntityChanged({ kind })`, all keeping `work-queue` delivery (cleanup + downstream-propagation are side-effecting writes that must run once per cluster):

- `dependency-system-cleanup`: reacts to `catalog-system` tombstones (`change.next === null`).
- `dependency-notification-evaluator` / `-recovery`: react to `health` changes filtered to a degraded / recovered transition via `classifyHealthChange`, reproducing the old `systemDegraded` / `systemHealthy` predicates.

`@checkstack/automation-backend` adds `makeEntityDrivenTriggerSetup()` - a no-op `setup` factory so a migrated domain's lifecycle triggers stay in the editor's trigger catalog (and register cleanly) while being fired by the entity change deriver via Stage-1 routing rather than a hook.

BREAKING CHANGES:
- The `dependency.created` / `dependency.updated` / `dependency.deleted` cross-plugin hooks (the `createHook` descriptors) are removed. Dependency lifecycle is now the reactive `dependency-edge` entity; the matching trigger events still fire (via the entity change deriver), so existing automations on `dependency.created/.updated/.deleted` keep working. The `dependency.impact_propagated` hook is KEPT (a derived fan-out signal, not a single mutable field). No in-repo plugin subscribed to the removed hooks.
- On the RPC create path, the `dependency.created` entity emit (via `mutate`) now precedes the `DEPENDENCY_CHANGED` realtime signal broadcast (previously the signal fired first, then the mirror); both still fire on a successful create.
- NARROWING: `dependency.updated` now fires only on a change to the REACTIVE state (`impactType`, `source`, `target`, or `transitive`). A label-only edit no longer fires `dependency.updated` (the label is not reactive entity state). Re-author any automation that needed to react to a label-only dependency edit against a different signal.
