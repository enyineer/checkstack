---
"@checkstack/automation-backend": patch
---

Clarify and harden single-pass health scope resolution in the dispatch engine (internal, behavior-preserving).

Two complementary projections of live state coexist by design - not as a migration shim - and the comments now say so:

- `scope.health.*` is the RICH condition snapshot (status, latency_ms, p95_latency_ms, success_rate, in_status_since, in_status_for_ms, in_maintenance, transitions_in_window, ...), resolved through the healthcheck RPC because the health aggregate is computed on read, not stored as a framework entity row. This is what the `state` / `numeric_state` condition evaluators read.
- `scope.state.<kind>.<id>.<field>` is the MINIMAL reactive entity view each kind's `defineEntity` exposes (e.g. an incident's `{ status, severity }`), resolved through the entity store for reactive `wait_until` wake re-evaluation.

The `wait_until` wake re-enrichment already resolves health via the rich RPC path and EXCLUDES the `health` kind from the entity-store pass, so health is round-tripped at most once per scope build. The misleading "back-compat alias / for one release / deprecation" wording around `scope.health` has been replaced with this accurate description across `state-scope.ts`, `engine.ts`, and `wake-refs.ts`.

Latent-bug fix: `projectHealthAlias` now guards against clobbering an existing richer `scope.health` (the rich snapshot is a strict superset of the minimal entity view), honoring its already-documented contract. This branch is unreachable from the dispatch engine today (no path resolves a `health` ref through the entity-store pass); the guard makes the defensive projection correct for any direct caller.

No condition-evaluation behavior changes: the fields conditions read from `scope.health.*` and `scope.state.<kind>.<id>.*` are unchanged. New regression tests assert health resolves once per wake (rich RPC path, never the entity resolver) and that the rich snapshot is never overwritten by the minimal view.
