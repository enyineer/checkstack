---
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/automation-backend": minor
---

Remove the legacy per-assignment auto-incident system. Auto-incidents are now built entirely by user-authored automations; nothing is seeded or hardcoded.

What was removed:

- The one-time migration that auto-seeded "sustained unhealthy" and "flapping" default automations from each assignment's notification policy, plus the `listAutoIncidentPolicies` RPC it consumed.
- The seeder-only notification-policy settings and their UI: `autoOpenIncidentOnUnhealthy`, `useNotificationSuppression`, `skipDuringMaintenance`, `sustainedUnhealthyTrigger`, and `autoCloseAfterMinutes`. The assignment **Notifications** tab now exposes only the two live settings: **Suppress de-escalation notifications** and the **flapping-detection** thresholds.
- The dead `health_check_auto_incidents` table (no longer written or read; dropped via migration).

What is preserved: flapping detection (`healthcheck.flapping_detected`) and de-escalation suppression are unchanged. The `flappingTrigger` and `suppressDeEscalations` policy fields stay exactly as before.

> [!NOTE]
> One-time cleanup: an automation-backend migration deletes the historically auto-seeded incident automations (`managed_by LIKE 'auto-incident:%'`) from existing databases. This is intentional and destructive - those automations were no longer managed by anything. If you had edited a seeded automation and want to keep it, re-create it as a normal automation before upgrading. See the "Build auto-incident automations" guide for templates.

> [!IMPORTANT]
> NARROWING: `NotificationPolicySchema` is narrowed to `{ suppressDeEscalations, flappingTrigger }`. Stored rows that still carry the removed legacy keys parse cleanly - zod strips the unknown keys on read - so no data migration is required for the `system_health_checks.notification_policy` column. GitOps `notificationPolicy` specs that set the removed fields are no longer accepted for those keys.
