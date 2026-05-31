---
"@checkstack/automation-backend": minor
"@checkstack/automation-common": minor
---

Add the entity state machine core (`defineEntity`) — the foundational primitive of the reactive automation engine (Phase 2).

One declaration gives a plugin a typed, reactive entity: storage, structural diffing, a per-field transition log, since/duration helpers, and an auto-emitted change event. State is framework-owned (a single generic `entity_state` + `entity_transitions` store), so a new entity kind needs zero migrations and off-pattern entity state is non-reactive by construction.

- `@checkstack/automation-backend`:
  - New `automation.entity` extension point exposing `defineEntity(input)` and `declareNonReactiveState(input)`. automation-backend registers the impl in Phase 1 (`register`), so other plugins can resolve it and declare entities during their own `register`/`init` (Proxy-buffered until the impl registers).
  - `defineEntity` returns an `EntityHandle` with `set` / `patch` (validate against the kind's zod object, mask run-originated writes through the run-secret registry, structural diff via a stable-stringify, no-op when unchanged, upsert + append per-field transition rows atomically, then emit an internal `ENTITY_CHANGED` event carrying the mutating actor), `get` / `getMany` (batched resolver), `remove` (tombstone change event), and `inStateSince` / `inStateForMs` / `transitionCount` over the transition log.
  - New generic `entity_state` (composite `(kind, entity_id)` PK, jsonb `state`) and `entity_transitions` (per-field log) tables + migration. Declarable secondary indexes (`EntityIndexSpec`) become partial Postgres expression indexes on `state->>'field'`, created idempotently at plugin init after migrations.
  - Load-time validation hard-fails a malformed registration (non-`z.object` state, missing/duplicate `kind`, an index field that is not a real state field).
  - The `ENTITY_CHANGED` hook is internal (not exported); the change emitter buffers events produced during the init window and flushes them in order once `emitHook` is wired in `afterPluginsReady`, so there is no silent no-emit gap.
  - Generalized scope enrichment: new `enrichScopeWithEntities` resolves any `state.<kind>.<id>` ref through a per-kind `getMany` resolver and folds it into `scope.state.<kind>.<id>.<field>`, with `scope.health` kept as a back-compat alias projection of `state.health.*`. The existing health-specific `enrichScopeWithState` and its conditions are unchanged.

- `@checkstack/automation-common`:
  - New `EntityChangedSchema` (the `ENTITY_CHANGED` payload — `kind`, `id`, `prev`, `next`, `delta`, `changedFields`, `actor`, `occurredAt`) and `DispatchJobSchema` (the Stage-2 `trigger` / `wake` dispatch job), consumed by the later reactive-dispatch phases.

This phase adds the primitive only: no domains are migrated to it yet, and the two-stage dispatch pipeline / wake-index land in later phases. No external behavior changes for existing automations.
