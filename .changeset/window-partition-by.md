---
"@checkstack/automation-common": minor
"@checkstack/automation-backend": minor
"@checkstack/automation-frontend": minor
"@checkstack/healthcheck-backend": minor
---

Add an optional `partitionBy` override to the windowed-count trigger gate.

A trigger's `window` block now accepts `partitionBy`, a bare expression (same flavour as `filter`, no `{{ }}`) that controls the key the occurrence count is bucketed by. When omitted, the gate keys by the trigger's built-in context key exactly as before (per system for health triggers), so existing automations are unchanged. When set, the expression is evaluated against the same trigger scope `filter` uses and coerced to a string - e.g. `trigger.payload.severity` for a per-severity rate, or `trigger.payload.systemId + ":" + trigger.payload.checkId` for a composite key. If the expression evaluates to null/undefined/empty or fails to evaluate, the gate falls back to the built-in context key (never global counting); eval errors are logged, matching the gate's fail-open posture.

Triggers can now declare `contextKeyLabel` (a UI hint, e.g. `"system"`) describing their built-in context dimension. It is surfaced through `TriggerInfo` so the editor's window "Partition by" field shows the default partition ("Leave blank to count per system" / "per automation" when a trigger has no context key). The healthcheck system triggers (`system_health_changed`, `system_degraded`, `system_healthy`, `check_failed`) and the built-in `numeric_state` trigger set it to `"system"`. This is a pure UI hint with no runtime behaviour.

The automation editor's window block gains a "Partition by" expression input (reusing the trigger filter's `trigger.payload.*` autocomplete), and the collapsed trigger card summary shows the partition when set.
