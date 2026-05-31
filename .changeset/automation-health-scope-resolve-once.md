---
"@checkstack/automation-backend": patch
---

Clarify and harden single-pass health scope resolution in the dispatch engine (internal, behavior-preserving).

Two complementary projections of live state coexist by design - not as a migration shim - and the comments now say so:

- `scope.health.*` is the RICH condition snapshot (status, latency_ms, p95_latency_ms, success_rate, in_status_since, in_status_for_ms, in_maintenance, transitions_in_window, ...), resolved through the healthcheck RPC because the health aggregate is computed on read, not stored as a framework entity row. This is what the `state` / `numeric_state` condition evaluators read.
- `scope.state.<kind>.<id>.<field>` is the MINIMAL reactive entity view each kind's `defineEntity` exposes (e.g. an incident's `{ status, severity }`), resolved through the entity store for reactive `wait_until` wake re-evaluation.

The `wait_until` wake re-enrichment resolves health via the rich RPC path and EXCLUDES the `health` kind from the entity-store pass, so health is round-tripped at most once per scope build. The misleading "back-compat alias / for one release / deprecation" wording around `scope.health` has been replaced with this accurate description across `state-scope.ts`, `engine.ts`, and `wake-refs.ts`.

Dead-code removal: `enrichScopeWithEntities` no longer projects anything into `scope.health` - the `projectHealthAlias` helper (and its call) is deleted. `scope.health` is now owned exclusively by the rich `enrichScopeWithState` path. The projection was unreachable in production (the dispatch engine never resolves a `health` ref through the generic entity pass), so this is strictly behavior-preserving.

No condition-evaluation behavior changes: the fields conditions read from `scope.health.*` and `scope.state.<kind>.<id>.*` are unchanged. A regression test asserts health resolves once per wake (rich RPC path, never the entity resolver), and the generic entity path is covered by a focused test asserting it folds `state.<kind>.<id>` for a non-health kind and never sets `scope.health`.
