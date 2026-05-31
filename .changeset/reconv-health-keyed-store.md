---
"@checkstack/healthcheck-backend": minor
"@checkstack/automation-backend": minor
---

Reconvert the `health` entity to the Model B reactive API with an explicit framework keyed store.

The per-system `health` aggregate (`{ status, healthyChecks, totalChecks }`, keyed by `systemId`) is HOMELESS: it is computed at check-evaluation time and has no domain table of its own (only the `health_check_*` transition log persists). It was previously store-backed via the deprecated `handle.set` sugar. It now opts into the framework keyed store (`entity_state`) EXPLICITLY and routes every evaluation-site write through `handle.mutate({ id: systemId, apply })`, where `apply` upserts the keyed store and returns the aggregate view.

Changes:

- `@checkstack/automation-backend`: expose `entityKeyedStoreServiceRef` (`EntityKeyedStoreService`) — cross-plugin access to the framework keyed store (`entity_state`) plus a transaction runner, both bound to automation-backend's schema-scoped DB. A homeless reactive kind whose state lives in `entity_state` (which sits behind automation-backend's scoped DB, unreachable through the consuming plugin's own scoped DB) reads/writes it through this service while staying reactive via `handle.mutate`.
- `@checkstack/healthcheck-backend`: `defineEntity({ kind: "health", read: keyedStore.readMany })`; `mirrorHealthEntity` now drives `handle.mutate` whose `apply` writes the keyed store inside a transaction on automation-backend's DB. Removed the deprecated `handle.set` usage and the `entity_state` expression `indexes` declaration (plugin-backed kinds index their own storage). The `health_check_runs` `declareNonReactiveState` escape hatch is unchanged.

Behavior-preserving: the `HEALTH_ENTITY_KIND`, `HealthEntityStateSchema`, the `healthcheck.system_degraded` / `_healthy` / `_health_changed` change-event deriver, and `classifyHealthChange` are byte-for-byte identical, so the `slo-backend` and `dependency-backend` consumers (which subscribe via `onEntityChanged({ kind: "health" })`) keep working unchanged. The transition history in `entity_transitions` is recorded for every change exactly as before.

BREAKING CHANGE: a plugin that built a homeless reactive entity over `entity_state` through the deprecated `handle.set` / `handle.patch` sugar must now declare an explicit `read` (e.g. via `entityKeyedStoreServiceRef.keyedStoreFor(kind).readMany`) and mutate through `handle.mutate`.
