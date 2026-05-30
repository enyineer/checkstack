---
"@checkstack/automation-common": minor
"@checkstack/automation-backend": minor
---

Add the `for:` dwell on triggers (Wave 2 Phase 15) - precise, event-driven, restart-safe "fire only if the matched state still holds after Y".

- New first-class `TriggerSchema.for` (decision D1): a single-unit duration (`{ seconds | minutes | hours }`) or `{ template }` rendering to seconds. A `durationToMs` helper resolves it. Not buried in `config`.
- New pre-run `automation_dwell_timers` table (decision D5): a dwell arms before any run exists, so it cannot reuse the run-scoped wait locks. Unique on `(automationId, triggerId, contextKey)` so a re-fire re-arms (pushes `fireAt`) rather than stacking timers.
- Arm / re-arm / fire / cancel wired into the trigger fan-in. When a `for:` trigger fires and its filter passes, the engine snapshots the current status, upserts the dwell row, and enqueues an `automation-dwell` wake job with the matching `startDelay` - no run starts yet.
- At expiry the dwell re-confirms (via the Phase 13 health-state provider) that the system is still in the armed status, then re-checks the automation's pre-run conditions, then starts the run honouring the concurrency mode. A recovery within the window cancels the pending fire even without an explicit inverse event.
- Cancellation is DB-side (delete the row; the queue job no-ops when it pops, since queue jobs are not cancellable). A contradicting state-change event eagerly deletes a stale dwell. Deleted automations drop their dwells via FK cascade; disabled automations drop them at fire time.
- Durability: the dwell row is the source of truth. A new `automation-dwell` queue consumer fires dwells, and the stalled sweeper catches expired rows whose job was lost. Both paths are idempotent via delete-on-fire, so a dwell fires at most once and survives restart.

Example:

```yaml
triggers:
  - event: healthcheck.system.degraded
    for: { minutes: 30 }
actions:
  - action: incident.create
    config:
      title: "{{ trigger.payload.systemName }} is critical"
      severity: critical
      systemIds: ["{{ trigger.payload.systemId }}"]
```
