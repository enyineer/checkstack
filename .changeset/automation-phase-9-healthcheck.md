---
"@checkstack/healthcheck-backend": minor
---

feat(healthcheck): Phase 9 — run_now / enable / disable actions + umbrella health-changed trigger

- New hook `healthCheckHooks.systemHealthChanged`, an umbrella variant
  of `systemDegraded` + `systemHealthy` that fires on **every**
  aggregated-health transition (with both `previousStatus` and
  `newStatus`). Emitted alongside the directional hooks at both
  emission sites in `queue-executor.ts`, so existing subscribers keep
  working unchanged.
- New hook `healthCheckHooks.checkFailed` — fires alongside the
  existing `checkCompleted` whenever an individual run's status
  isn't `healthy`. Exists as a narrow alternative so an automation
  doesn't need "trigger on completion → filter by status" — useful
  for incident-style flows.
- New hook `healthCheckHooks.flappingDetected` — fires from inside
  the auto-incident evaluator whenever the unhealthy-transition count
  crosses `policy.flappingTrigger.transitions` within
  `policy.flappingTrigger.windowMinutes`, regardless of whether
  `autoOpenIncidentOnUnhealthy` is enabled. Carries the observed
  count + window so subscribers can reason about both. Re-fires on
  every additional transition past the threshold while the check
  stays flapping — debounce on `(systemId, configurationId)` if
  "page once and only once" is wanted.
- Triggers `healthcheck.system_degraded`,
  `healthcheck.system_healthy`, the umbrella
  `healthcheck.system_health_changed`, plus the new
  `healthcheck.check_failed` and `healthcheck.flapping_detected`.
  Inline trigger registrations moved out of `register()` into
  `automations.ts`.
- Actions `healthcheck.run_now` (enqueues a one-off job on the
  shared `HEALTH_CHECK_QUEUE`), `healthcheck.enable_assignment`, and
  `healthcheck.disable_assignment`. The enable/disable actions use a
  new service method `setAssignmentEnabled(systemId, configurationId,
  enabled)` that flips just the `enabled` flag without touching
  thresholds / satellite assignment / notification policy. Both fire
  the existing `assignmentChanged` hook so the satellite config relay
  picks up the change.
- Artifact type `healthcheck.assignment` for downstream steps to
  consume.

`HEALTH_CHECK_QUEUE` is exported so the `run_now` action can enqueue
without re-importing the recurring-job factory.
