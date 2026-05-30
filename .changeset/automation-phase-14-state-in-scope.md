---
"@checkstack/template-engine": minor
"@checkstack/automation-common": minor
"@checkstack/automation-backend": minor
"@checkstack/automation-frontend": minor
---

Add live state in scope plus duration helpers to the automation sensing layer (Wave 2 Phase 14).

- `@checkstack/template-engine` ships four pure, synchronous duration filters: `minutes` and `hours` (number to milliseconds), `duration_since` (ms elapsed since an ISO timestamp), and `older_than(thresholdMs)` (boolean dwell check). They compute against real time at call time, so "now" is fresh per evaluation. Fail-safe on null/unparseable input.
- The dispatch engine pre-resolves live health state into scope before any condition or template evaluation (the engine is synchronous, so inline state queries are impossible). State is folded under a `health` namespace - `health.system.*` for the trigger's context system and `health.systems[<id>]` for ids listed in the automation's new `uses_state` field. One batched `getBulkHealthState` query per evaluation, wired at the fresh-run, resume, and trigger-gate sites. Fail-open: a missing client or provider error yields an empty namespace and a warning, never wedging unrelated automations.
- New `automationFilterExtensionPoint` lets plugins contribute pure template filters without forking the engine's default registry. Name collisions with built-ins are skipped with a warning.
- The editor variable-scope resolver and autocomplete catalogue now surface the `health.*` namespace and the new duration filters.

With this phase alone, an operator can build "notify me when a system has been unhealthy for 30 minutes" using an interval trigger plus a single `health.*` condition - no dwell timer required (the precise event-driven path lands in Phase 15).
