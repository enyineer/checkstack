---
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-common": minor
"@checkstack/automation-common": minor
"@checkstack/automation-backend": minor
---

Add a windowed transition count to the health provider - the building block for custom flapping rules (Wave 2 Phase 18).

Flapping is already buildable today via the built-in `healthcheck.flapping_detected` trigger; this phase ships the GENERALIZATION for arbitrary "N status changes in M minutes" rules.

- `countStateTransitionsInWindow` counts aggregate status transitions for a system over a trailing window (from the Phase 13 `health_check_state_transitions` table - all statuses, generalizing the unhealthy-only flapping detector). Fail-safe to 0.
- `getHealthState` / `getBulkHealthState` now return `transitionsInWindow` + `transitionWindowMinutes`, and accept an optional `transitionWindowMinutes` input (default 60).
- The automation definition gains an optional top-level `state_window_minutes` (default 60), threaded through `enrichScopeWithState` so `health.system.transitions_in_window` / `health.system.transition_window_minutes` are folded into scope per evaluation.
- Operators author custom flapping as a `numeric_state` condition over `health.system.transitions_in_window` - no new condition variant, no editor change. The variable-scope resolver surfaces the new fields for autocomplete.
