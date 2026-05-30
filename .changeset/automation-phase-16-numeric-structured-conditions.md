---
"@checkstack/automation-common": minor
"@checkstack/automation-backend": minor
---

Add the `numeric_state` trigger and three structured condition variants (Wave 2 Phase 16, backend-only).

- New built-in `numeric_state` trigger: hook-backed on `healthcheck.check.completed`, fires when a numeric field (`latencyMs`, `p95LatencyMs`, or a `collectors.<id>.<field>` path) crosses an `above` / `below` threshold. The per-automation threshold is enforced by a new structured config gate (`TriggerDefinition.evaluateConfig`) that runs before the operator's template filter. Pairs with a trigger-level `for:` (Phase 15) for sustained thresholds. v1 is level-triggered; edge de-duplication is deferred.
- Extended the condition grammar (`ConditionInput`) beyond `string | and | or | not` with three typed variants evaluated over the pre-resolved `health.*` scope plus a FRESH `now` per evaluation:
  - `numeric_state`: `{ value, above?, below? }` (value is a literal number or a template/path string).
  - `time`: `{ after?, before?, weekday?[], timezone? }` for on-call / quiet-hours gating, including overnight windows wrapping midnight, weekday filtering, and IANA timezone resolution via `Intl`.
  - `state`: `{ entity, status, for? }` - a condition-side dwell read from `health.systems[entity].in_status_for_ms` (no new timer; it reads, it doesn't time).
- The raw template string stays the escape hatch. Everything round-trips through zod and YAML.

Editor widgets (ConditionEditor branches, duration/time-of-day inputs, operator selects) are intentionally deferred to Phase 19; the YAML editor already round-trips the new schema, so the feature is fully usable and testable via YAML today.
