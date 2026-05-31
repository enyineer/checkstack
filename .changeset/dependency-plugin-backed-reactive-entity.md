---
"@checkstack/dependency-backend": minor
---

Make `dependency-edge` a plugin-backed reactive entity driven through `handle.mutate`.

The `dependencies` table is now BOTH authoritative AND the `dependency-edge`
entity's current-state storage — there is no framework `entity_state` row for a
dependency edge anymore. `defineEntity` is given a plugin `read` accessor
(`DependencyService.getManyEntityStates`) that projects the reactive subset
`{ sourceSystemId, targetSystemId, impactType, transitive }` straight off that
table.

Every reactive-state write now goes through `handle.mutate` / `handle.remove`:
`apply` performs the REAL `dependencies` write (the plugin's own db/tx,
including the cycle/duplicate validation that may throw) and returns the new
state; the framework snapshots `prev` BEFORE the write, appends the transition
log (its own db), and emits `ENTITY_CHANGED` AFTER the write commits. The
Phase-4 `handle.set` mirror calls (and the `mirrorDependencyEdge` helper) are
removed. Covered sites: create, update, delete (tombstone), plus the
`dependency.create` / `dependency.remove` automation actions. The create sites
pre-generate the id so the handle is keyed on it and the create's `prev`
snapshot reads the not-yet-existing row as absent; `createDependency` accepts
an optional pre-generated `id` (server-owned either way).

The change-deriver (`dependency.created` / `.updated` / `.deleted`), the kept
`dependency.impact_propagated` hook + trigger, the
`dependency_derived_states` non-reactive escape-hatch, and the existing
`onEntityChanged` consumers (dependency reacts to `health` degraded/recovered
and to the `catalog-system` tombstone) are ALL unchanged — they consume change
events and are not part of this reconversion. No behavior change for consumers.

BREAKING CHANGES (behavior): none for trigger-event consumers. The only
observable change is internal: dependency current state is read from the
`dependencies` table instead of `entity_state`, and writes are routed through
the entity handle. On the RPC create path, the `dependency.created` entity
emit (via `mutate`) now precedes the `DEPENDENCY_CHANGED` realtime signal
broadcast (previously the signal fired first, then the mirror); both still fire
on a successful create.
