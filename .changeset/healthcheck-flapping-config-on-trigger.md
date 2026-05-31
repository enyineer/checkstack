---
"@checkstack/automation-backend": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-frontend": minor
---

Move health-check flapping configuration from the per-assignment notification policy onto the `healthcheck.flapping_detected` automation trigger.

Flapping thresholds (`transitions`, `windowMinutes`) are now configured on the trigger itself, next to the automation that reacts to them, instead of on each check assignment. The health-check executor still owns the windowed transition counting (it writes `health_check_unhealthy_transitions` and runs the window query), but it now SOURCES the thresholds from the subscribed automations' trigger config:

- On a transition-to-unhealthy it records the transition unconditionally (keeping history warm), then looks up the enabled automations subscribed to `healthcheck.flapping_detected`, collects the distinct set of configured windows, counts transitions once per distinct window, and emits one `healthcheck.flapping_detected` per window. The trigger's exact-window `evaluateConfig` gate then fires each automation only for its own window and transition threshold.
- A missing or partial flapping trigger config defaults to `{ transitions: 3, windowMinutes: 60 }`, so automations created before the trigger carried config keep working unchanged.
- `automation-backend` exposes a new backend-only, read-only `automationSubscriptionsRef` service ref (`findEnabledByTriggerEvent`) so a plugin that owns a trigger's underlying event can discover its subscribers' trigger config. It is never browser-exposed.

**BREAKING CHANGES**

- The per-assignment `notificationPolicy.flappingTrigger` field is removed. `NotificationPolicy` is now `{ suppressDeEscalations }` only. Stored rows that still carry a `flappingTrigger` key parse cleanly - the key is stripped on read - so no data migration is required, but the per-check flapping toggle/threshold in the assignment Notifications tab is gone; configure flapping on the trigger instead.
- The GitOps `System.healthcheck[].notificationPolicy.flappingTrigger` field is removed. A `flappingTrigger` block in a manifest is ignored. Move the thresholds to the `transitions` / `windowMinutes` config of your `healthcheck.flapping_detected` automation trigger.
- The standalone `enabled` flag for flapping is gone: flapping is "enabled" precisely when at least one enabled automation subscribes to `healthcheck.flapping_detected`. With no subscriber, the transition is still recorded but nothing is counted or emitted.
