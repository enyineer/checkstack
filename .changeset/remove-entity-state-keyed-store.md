---
"@checkstack/automation-backend": minor
---

Remove the orphaned framework keyed store and its `entity_state` table.

The entity state machine (Model B) is fully plugin-backed: every entity kind
owns its current-state storage and exposes it through a `read` accessor
(incident / catalog / dependency / maintenance / slo over their own tables,
satellite over `satellites`, health computed on read). The generic framework
keyed store and its `entity_state` table had no remaining users, so they are
removed:

- `createKeyedStore` + the `KeyedStore` type (and the `create-keyed-store.ts`
  module) are gone.
- The `entityKeyedStoreServiceRef` service ref and its `EntityKeyedStoreService`
  interface (plus the `keyedStoreFor` / `runInTransaction` service
  registration) are removed.
- The `entity_state` table is dropped via a new forward-only migration.

The durable change-history log (`entity_transitions`) is fully retained, as is
`entityResolverFor`, which continues to resolve every plugin-backed kind via
its `read` accessor (powering scope enrichment and reactive `wait_until` wake
re-evaluation). `inStateSince` / `inStateForMs` / `transitionCount` are
unchanged.

BREAKING CHANGES: The `entity_state` table is dropped on migrate. Any
out-of-tree plugin that injected `entityKeyedStoreServiceRef` or imported
`createKeyedStore` / `KeyedStore` / `EntityKeyedStoreService` must instead own
its entity state in its own storage and pass a `read` accessor to
`defineEntity`. No in-tree plugin used the keyed store, so no in-tree behavior
changes.
