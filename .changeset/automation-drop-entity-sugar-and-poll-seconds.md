---
"@checkstack/automation-backend": minor
"@checkstack/automation-common": minor
"@checkstack/automation-frontend": minor
---

Remove the now-dead transitional code left over from the Model B entity rework: the deprecated store-backed `EntityHandle` sugar and the inert `wait_until` `poll_seconds` field.

All seven domains now write through the driven `handle.mutate({ id, apply })` / `handle.remove({ id, apply })` API (homeless kinds opt into `createKeyedStore` and write `entity_state` from inside their own `apply`). The transitional back-compat surface is gone:

- `EntityHandle.set` / `EntityHandle.patch` and the store-backed `remove(id, opts)` overload are removed; `remove` now only accepts `{ id, apply }`.
- `defineEntity` now REQUIRES a plugin `read` accessor — the no-`read` auto-keyed-store branch in the registry is removed, along with the declarable expression-index path (`indexes` on `defineEntity`, `EntityIndexSpec`, `buildAllIndexDdl`, `EntityRegistry.getIndexDdl`, and the boot-time index-creation loop). No live kind used it; homeless kinds use `createKeyedStore` (unchanged), which takes no indexes.
- `EntityRegistry.setStore` no longer takes a `keyedStoreFactory`.

KEPT and unchanged: `createKeyedStore` + the `entityKeyedStoreServiceRef` service (used by healthcheck's homeless `health` kind), the `entity_state` table, the `entity_transitions` log, plugin-backed `mutate` / `remove`, `read`, and `entityResolverFor`.

The `wait_until` action's `poll_seconds` / `pollSeconds` field is removed everywhere (schema, dispatch engine, persisted wait-lock snapshot type, migration emitter, and the editor default + form field). Reactive waits never polled; the field was inert. Resuming an OLD suspended wait whose persisted snapshot still carries `pollSeconds` is unaffected: the snapshot schema is a non-strict `z.object`, so the extra key is silently stripped on load (regression-tested).

BREAKING CHANGES:

- `poll_seconds` is no longer accepted in `wait_until` action config — reactive waits don't poll. Existing automation specs that still set it will have the key ignored at parse time (or surface as an unknown-key validation error in strict callers); remove it.
- `EntityHandle.set` / `.patch` and the `remove(id, opts)` overload are removed; use `handle.mutate({ id, apply })` / `handle.remove({ id, apply })`.
- `defineEntity` requires a `read` accessor; passing `indexes` is no longer supported.
