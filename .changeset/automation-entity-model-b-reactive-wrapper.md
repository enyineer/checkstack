---
"@checkstack/automation-backend": minor
---

Reshape `defineEntity` into a Model B uniform reactive wrapper.

`defineEntity` no longer owns any current-state storage of its own. Each
kind declares a plugin `read` accessor pointing at wherever its state lives
(its own table, an in-memory map, a computed value, or the framework keyed
store), and `defineEntity` makes that state reactive. This makes a
non-reactive write structurally impossible and guarantees every transition
is durably logged — even for an in-memory-backed kind.

Changes:

- **Driven single mutation entry point.** All reactive-state writes go
  through `handle.mutate({ id, opts?, apply: (tx) => Promise<TState> })`. The
  handle snapshots `prev` via `read` BEFORE the write, runs the plugin's
  `apply` (the actual write) inside ONE transaction, diffs prev -> next, and
  on a real diff appends the field-level transition to the framework
  `entity_transitions` table IN THE SAME TRANSACTION, then emits
  `ENTITY_CHANGED` AFTER COMMIT (never on a rolled-back write). A
  structurally-unchanged write is a no-op (no transition, no emit).
- **Driven tombstone.** `handle.remove({ id, opts?, apply })` records the
  tombstone transition and emits a tombstone change (next = null) after
  commit.
- **Universal framework history.** `entity_transitions` is written for EVERY
  kind regardless of where current state lives, so `inStateSince` /
  `inStateForMs` / `transitionCount` work uniformly.
- **`createKeyedStore(kind)`** — a turnkey current-state store for homeless
  kinds, backed by the generic `entity_state` table (+ declarable expression
  indexes). It exposes `read` / `readMany` and a tx-aware `write` / `remove`
  that plug into `defineEntity({ read })` / `handle.mutate`.
- **`entityResolverFor(kind)`** routes scope enrichment + the reactive
  `wait_until` wake re-eval to each kind's `read` accessor (plugin-backed
  kinds via their own `read`; store-backed kinds via the auto-wired keyed
  store). The emitted `ENTITY_CHANGED` payload, `registerChangeDeriver`,
  `onEntityChanged`, and Stage-1/Stage-2 dispatch are unaffected.

BREAKING CHANGES: the store-owned `set` / `patch` / `remove(id)` API and the
`indexes`-only `defineEntity({ kind, state, indexes })` form are now
deprecated back-compat sugar (re-expressed over the new core +
`createKeyedStore`); they keep the not-yet-migrated domains green and are
removed in a later step. New code should declare a `read` accessor and mutate
through `handle.mutate` / `handle.remove` with its own `apply`.
