---
"@checkstack/automation-common": minor
"@checkstack/automation-backend": minor
"@checkstack/automation-frontend": minor
---

Add the `wait_until` action primitive (Wave 2 Phase 17) - suspend a running automation until a condition becomes true, with an optional timeout (HA's `wait_template`).

- New `wait_until: { condition, timeout_seconds?, continue_on_timeout?, poll_seconds? }` primitive. `continue_on_timeout` defaults to true (HA semantics); `poll_seconds` defaults to 30. Added to the schema, the action union, and `detectActionKind`.
- `condition` accepts any condition shape - a template string or the Phase 16 structured `numeric_state` / `time` / `state` variants.
- Durable polling-resume: if the condition is already true it continues inline; otherwise it persists a `kind: "until"` wait lock (carrying the condition + poll interval + timeout policy in a new `wait_config` jsonb column) and enqueues an `automation-wait-until` re-check job. Each tick re-enriches `health.*` (Phase 14) then sync-evaluates the condition: true resumes the run, timeout resumes-and-continues or fails per `continue_on_timeout`, still-false re-schedules. Resumes take the per-run advisory lock so a tick and a sweep can't double-resume.
- Survives restart: the wait lock is the source of truth, and the stalled sweeper re-ticks `until` locks as a backstop if a re-check job is lost (essential for a `wait_until` with no timeout).
- Works nested inside `choose` / `parallel` / `repeat` via the existing resume-remainder mechanism.
- Editor: a `wait_until` action card (frontend) mirroring `wait_for_trigger` - a `ConditionEditor` plus poll-interval, timeout, and continue-on-timeout inputs. The structured numeric/time/state ConditionEditor branches land with the rest of the sensing-layer editor work; the card uses the expression-based editor for now.
