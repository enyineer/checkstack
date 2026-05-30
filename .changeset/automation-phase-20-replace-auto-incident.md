---
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-common": minor
"@checkstack/automation-backend": minor
---

Replace the hardcoded auto-incident path with default automations (Wave 2 Phase 20).

BREAKING CHANGES: Auto-incident is now automation-driven. The hardcoded background path that opened incidents on sustained-unhealthy / flapping and closed them after a cooldown (`auto-incident.ts`, `auto-incident-close-job.ts`) is removed. On upgrade, an idempotent, threshold-preserving migration seeds equivalent default automations - one per (system, check) assignment - from each assignment's existing `NotificationPolicy`, so alerting behaviour is preserved 1:1:

- `sustainedUnhealthyTrigger.durationMinutes` -> the `for:` dwell on a `healthcheck.system_degraded` trigger -> `incident.create`.
- auto-close `autoCloseAfterMinutes` -> a `wait_until` (healthy continuously for the cooldown) -> `incident.resolve`.
- `useNotificationSuppression` -> the incident's `suppressNotifications`.
- `skipDuringMaintenance` -> a `{{ !health.system.in_maintenance }}` pre-run condition.
- `flappingTrigger.{transitions,windowMinutes}` -> a second automation on the `healthcheck.flapping_detected` trigger -> `incident.create`.

Operators can now read, edit, disable, and extend these automations (see the "Customise auto-incident" guide). Seeded automations are tagged via `managedBy` (`auto-incident:<systemId>:<configurationId>:<kind>`) so the migration is a no-op on re-runs; anything unmappable is recorded as a migration-failure row.

One documented behaviour change: auto-incidents are now per-(system, check) rather than per-system. A system with two independently-failing checks gets one auto-incident per check, each opening/closing on its own thresholds; the old path deduped per-system across checks. Per-system run dedup within an automation is preserved via `concurrency_scope: "context_key"` + `mode: "single"`.

Flapping DETECTION (transition recording + the `healthcheck.flapping_detected` emit) is relocated into `flapping-detector.ts` and survives; the emit now fires unconditionally on a threshold cross (no longer gated on `autoOpenIncidentOnUnhealthy`), matching the hook's documented intent and required for the flapping default automation. The legacy `health_check_auto_incidents` mapping table is no longer written or read (it will be dropped in a follow-up migration); `health_check_unhealthy_transitions` is retained for the flapping detector.

New service-typed `HealthCheckApi.listAutoIncidentPolicies` RPC exposes each assignment's effective notification policy for the migration.
