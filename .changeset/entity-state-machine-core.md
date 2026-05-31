---
"@checkstack/automation-backend": minor
"@checkstack/automation-common": minor
"@checkstack/automation-frontend": minor
---

Add the entity state machine core (`defineEntity`) - the foundational primitive of the reactive automation engine - as a Model-B plugin-backed reactive WRAPPER with NO framework-owned current-state storage.

`defineEntity` owns NO current-state storage of its own. Each kind declares a required plugin `read` accessor pointing at wherever its state lives (its own durable table, or a value computed on read from its own durable tables), and `defineEntity` makes that state reactive. There is no framework current-state store and no "homeless" fallback: every kind is plugin-backed. This makes a non-reactive write structurally impossible and guarantees every transition is durably logged without duplicating the plugin's state.

- `@checkstack/automation-backend`:
  - New `automation.entity` extension point exposing `defineEntity(input)`, `declareNonReactiveState(input)`, `onEntityChanged(...)`, and `registerChangeDeriver(...)`. automation-backend registers the impl in `register`, so other plugins can resolve it and declare entities during their own `register`/`init` (Proxy-buffered until the impl registers).
  - **Driven single mutation entry point.** All reactive-state writes go through `handle.mutate({ id, opts?, apply: () => Promise<TState> })`. The handle snapshots `prev` via `read` BEFORE the write, runs the plugin's `apply` (the actual write, committed in the PLUGIN's own transaction, returning the resulting state), validates `next` (zod), masks run-originated writes through the run-secret registry, diffs prev to next, and on a real diff appends the field-level transition rows to `entity_transitions` and emits `ENTITY_CHANGED` - both AFTER the plugin write commits (never on a rolled-back / throwing write). A structurally-unchanged write is a no-op. `handle.remove({ id, opts?, apply: () => Promise<void> })` is the tombstone counterpart (records the tombstone transition, emits next = null).
  - **Cross-plugin transaction boundary.** `apply` takes NO framework tx: a plugin-backed kind lives behind a DIFFERENT drizzle client than `entity_transitions`, and two clients cannot share one transaction. The plugin write is authoritative; the transition-log append runs in the framework's own transaction AFTER the plugin write commits. A failure between them leaves correct plugin state with a missing history row (a gap, never a corruption).
  - **`get` / `getMany`** route to the kind's `read`; **`inStateSince` / `inStateForMs` / `transitionCount`** read the per-field `entity_transitions` log (generalizing Phase-13 health transitions to any entity).
  - **No framework keyed store.** There is no generic `entity_state` table, no `createKeyedStore`, and no `entityKeyedStoreServiceRef`: kinds whose state has no domain table of their own (the `health` aggregate, the `slo` budget/streak view) compute their `read` on demand from their own durable data instead of materializing a framework copy. `entity_transitions` (the change-history log) is the framework's ONLY persistent table and is written for EVERY kind regardless of where current state lives.
  - **`entityResolverFor(kind)`** routes scope enrichment + the reactive `wait_until` wake re-eval to each kind's `read` accessor. Generalized scope enrichment (`enrichScopeWithEntities`) folds any `state.<kind>.<id>` ref into `scope.state.<kind>.<id>.<field>`. The rich `scope.health.*` condition snapshot (status, latency, success rate, in-maintenance, transitions-in-window, ...) is resolved EXCLUSIVELY through the healthcheck RPC path (the health aggregate is computed on read, not stored as a framework row) and the generic entity pass never writes `scope.health`; `state.health.*` remains the minimal reactive entity view. These are two complementary projections by design, not a migration shim.
  - **Horizontal-scale read-consistency guard.** A reactive entity's current state MUST be globally readable from shared/durable storage, never process-local memory (`.agent/rules/state-and-scale.md`). Enforced by the `checkstack/no-pod-local-entity-state` ESLint tripwire at the `defineEntity({ read })` boundary (wired at `warn`) and the deterministic `cross-pod-read-consistency.it.test.ts` integration test.
  - Load-time validation hard-fails a malformed registration (non-`z.object` state, missing/duplicate `kind`, or a missing / non-function `read`).
  - The `ENTITY_CHANGED` hook is internal (not exported); the change emitter buffers events produced during the init window and flushes them in order once the hook wiring is available in `afterPluginsReady`.

- `@checkstack/automation-common`:
  - New `EntityChangedSchema` (the `ENTITY_CHANGED` payload - `kind`, `id`, `prev`, `next`, `delta`, `changedFields`, `actor`, `occurredAt`) and `DispatchJobSchema` (the Stage-2 `trigger` / `wake` dispatch job).

- `@checkstack/automation-frontend`: the `wait_until` editor no longer offers the inert `poll_seconds` field (reactive waits don't poll).

This phase adds the primitive only: domains are migrated in their own changesets. No external behavior changes for existing automations.

BREAKING CHANGES: There is no framework current-state store. Any out-of-tree plugin must own its entity state in its own durable storage (its own table, or a compute-on-read over it) and pass a `read` accessor to `defineEntity`. `createKeyedStore` / `KeyedStore` / `entityKeyedStoreServiceRef` / `EntityKeyedStoreService` do not exist, and there is no `entity_state` table. `handle.set` / `handle.patch` and the `indexes` option do not exist; all writes go through `handle.mutate` / `handle.remove`.
