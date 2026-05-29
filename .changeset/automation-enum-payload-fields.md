---
"@checkstack/healthcheck-backend": minor
"@checkstack/dependency-backend": minor
"@checkstack/maintenance-backend": minor
"@checkstack/slo-backend": minor
"@checkstack/incident-backend": minor
---

feat(automation): type enum-able trigger/artifact fields as enums for editor value autocompletion

The automation editor's staged completion offers concrete values after a
comparator (`{{ trigger.payload.severity == "high" }}`) only when the
field's JSON Schema carries an `enum`. Several trigger payload + artifact
schemas declared closed-set fields as loose `z.string()`, so no values
were suggested. Tightened them to the canonical enums that already
existed in each plugin's `-common` package (and matched the hook payload
types in lockstep so the trigger's `payloadSchema` and `hook` keep the
same `TPayload`):

- **incident** — trigger payloads: `severity` → `IncidentSeverityEnum`,
  `status` / `statusChange` → `IncidentStatusEnum`.
- **healthcheck** — trigger payloads: `previousStatus` / `newStatus` /
  `status` → `HealthCheckStatusSchema` (across systemDegraded,
  systemHealthy, systemHealthChanged, checkFailed; plus checkCompleted's
  hook type).
- **dependency** — trigger + artifact: `impactType` → `ImpactTypeSchema`;
  impactPropagated `previousState` / `newState` → `DerivedStateSchema`.
  Also deduped the inline `impactTypeSchema` action-config enum to reuse
  the canonical `ImpactTypeSchema`.
- **maintenance** — trigger + artifact: `status` →
  `MaintenanceStatusEnum`; deduped the inline `maintenanceStatusEnum`
  (used by `add_update.statusChange`) to the canonical one.
- **slo** — `achievement.unlocked` trigger + hook: `achievement` →
  `AchievementTypeSchema`.

Runtime behaviour is unchanged — these fields always carried valid enum
values (the underlying records are enum-constrained); only the schema
types were loose. The hook payload generics are now precise too, which
caught one stale test fixture asserting an invalid `impactType: "soft"`.

Fields that look enum-ish but are genuinely free-form were intentionally
left as `z.string()`: satellite `region` (user-entered), Jira issue
`status` (per-instance workflow name), notification `strategyQualifiedId`
/ `errorMessage`, healthcheck collector `result`, and script
`stdout` / `stderr`.
