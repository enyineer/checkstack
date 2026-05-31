---
"@checkstack/automation-common": minor
"@checkstack/automation-backend": minor
"@checkstack/automation-frontend": minor
---

Add the `wait_until` action primitive (Wave 2 Phase 17) - suspend a running automation until a condition becomes true, with an optional timeout (HA's `wait_template`).

- New `wait_until: { condition, timeout_seconds?, continue_on_timeout? }` primitive. `continue_on_timeout` defaults to true (HA semantics). Added to the schema, the action union, and `detectActionKind`. (The wait is fully reactive - see the reactive-dispatch-pipeline changeset; there is no `poll_seconds`.)
- `condition` accepts any condition shape - a template string or the Phase 16 structured `numeric_state` / `time` / `state` variants.
- Reactive resume: if the condition is already true it continues inline; otherwise it persists a `kind: "until"` wait lock (carrying the condition + timeout policy in a new `wait_config` jsonb column). The reactive-dispatch-pipeline changeset replaces the original poll-based re-check with a wake-index + a single timeout timer, so the wait is woken by a relevant entity change rather than ticked on an interval. Resumes take the per-run advisory lock so a wake and a sweep can't double-resume.
- Survives restart: the wait lock is the source of truth, and the stalled sweeper applies the timeout policy as a backstop if the wake/timer signal is lost.
- Works nested inside `choose` / `parallel` / `repeat` via the existing resume-remainder mechanism.
- Editor: a `wait_until` action card (frontend) mirroring `wait_for_trigger` - a `ConditionEditor` plus timeout and continue-on-timeout inputs. The structured numeric/time/state ConditionEditor branches land with the rest of the sensing-layer editor work; the card uses the expression-based editor for now.
