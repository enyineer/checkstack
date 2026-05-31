---
"@checkstack/automation-common": minor
"@checkstack/automation-backend": minor
"@checkstack/automation-frontend": minor
"@checkstack/healthcheck-backend": minor
---

Add a generic windowed-count / rate trigger gate, and express flapping detection on it.

Any trigger can now carry a `window: { count, minutes, refire }` block: the automation engine records each qualifying occurrence (after the structured config gate and the operator's `filter`) in a durable append log and counts rows within the trailing sliding window, scoped per context key (e.g. per system). `refire: "every"` (default) fires on every occurrence at/over the threshold; `refire: "once"` fires only on the crossing edge and re-arms as old occurrences age out. The gate runs in `maybeStartRun` after `filter` and before the `for:` dwell, so it composes with both.

Flapping is now an instance of this mechanism rather than a bespoke detector. The healthcheck `system_health_changed` raw change event plus a `filter` (`trigger.payload.newStatus != "healthy"`) plus `window: { count: 3, minutes: 60, refire: "once" }` reproduces flapping in the engine.

State-and-scale: window state lives in the new `automation_window_events` Postgres table (FK-cascade on the automation, the same delete-lifecycle as `automation_dwell_timers`). The count is read with pure SQL so every pod computes the same answer; the work-queue claim gives exactly one INSERT per emission, so there is no double-count. Rows older than the 24h schema cap are pruned by the existing stalled-sweeper. The `once` policy is best-effort under at-least-once redelivery (a redelivered emission can skip the exact crossing edge; `every` is redelivery-tolerant).

**BREAKING CHANGES:**

- The `healthcheck.flapping_detected` automation trigger and the `healthcheck.flapping_detected` hook are REMOVED. Flapping is now detected by the windowed-count gate on the `healthcheck.system_health_changed` trigger (`window` block, `refire: "once"`).
- Flapping is now PER-SYSTEM (the aggregated `health` entity), not per-`(system, configuration)`. Subscribe to `check_failed` with a `window` instead if you need per-check rate detection.
- The healthcheck `health_check_unhealthy_transitions` table is DROPPED (the per-check flapping audit log is no longer kept; counting moved into the engine).
- The backend-only `automation.subscriptions` service ref (`automationSubscriptionsRef` / `AutomationSubscriptions`) is REMOVED. The engine enumerates subscribers internally and the window gate runs per-automation inside `maybeStartRun`, so the external read-ref is no longer needed.
- Existing user-created flapping automations are AUTO-MIGRATED on boot: any trigger on `healthcheck.flapping_detected` is rewritten to `healthcheck.system_health_changed` + the canonical unhealthy-transition filter + `window: { count: transitions ?? 3, minutes: windowMinutes ?? 60, refire: "once" }`, dropping the old `config`. A pre-existing trigger filter is replaced with the canonical one (logged per row). An enabled automation that still references the removed event after migration logs a warning.
