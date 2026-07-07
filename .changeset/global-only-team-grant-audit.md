---
"@checkstack/anomaly-common": minor
"@checkstack/automation-common": minor
"@checkstack/automation-backend": minor
"@checkstack/automation-frontend": minor
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/incident-common": minor
"@checkstack/incident-backend": minor
"@checkstack/incident-frontend": minor
"@checkstack/maintenance-common": minor
"@checkstack/maintenance-backend": minor
"@checkstack/maintenance-frontend": minor
---

Fix a class of 403s where team-scoped managers were blocked from endpoints they
needed. A repo-wide audit of every `instanceAccess: { global: true }` procedure
found more instances of the same bug behind the health-check editor fix: an
endpoint on a team-scopable resource type, gated so only the GLOBAL access rule
(never a team grant) authorizes it.

Automation: the editor utilities and catalogs (`validateDefinition`,
`listTriggers`, `listActions`, `listArtifactTypes`, `listAutomationGroups`,
`listAutomationTemplates`, `renderTemplate`, `testScript`) now use `typeScoped`
so a team-scoped automation manager can author without the global rule. The run
endpoints (`listRuns`, `getRun`, `cancelRun`, `getRunScopeForReplay`) are scoped
to their parent automation via `parentScope` on `automationId`; `getRun`,
`cancelRun`, and `getRunScopeForReplay` now take the owning `automationId`
(always available in the run URL/editor) and the handler filters the run fetch by
it, so a run id cannot be paired with a foreign automation the caller happens to
hold a grant on. The two migration-admin endpoints stay `global: true` (genuine
platform-admin actions).

Health check: `validateConfiguration` (editor deep-validate) and
`getPlatformNotificationDefaults` (fetched on every assignment-editor mount) move
to `typeScoped`. The paired WRITE `setPlatformNotificationDefaults` stays
`global: true` on purpose - it rewrites instance-wide defaults for every team, so
a single team grant must not authorize it. Because that write stays global-only,
the assignment editor's "Notification defaults" button is now gated on the global
`configuration.manage` rule (`healthcheck-frontend`), so a team-scoped manager no
longer sees an editor whose Save always 403'd.

Anomaly: the anomaly settings panels embedded in the health-check editor
(`updateAnomalyConfig` / `getAnomalyConfig` and `updateAnomalyAssignmentConfig` /
`getAnomalyAssignmentConfig`) were authorized against the non-team-scopable
`anomaly_feed` type (via `global: true` or an `idParam` that could never match a
team grant), so a team-scoped manager who owns the check/system saw "Save
Defaults" / "Save Exceptions" buttons whose Save always 403'd. They now
`parentScope` on the owning health-check configuration (`healthcheck.healthcheck`)
and catalog system (`catalog.system`) respectively, so managing the check/system
authorizes reading and editing its anomaly settings. The frontend needed no
change: those buttons were already disabled for non-managers, and the panels are
only reachable inside the manager-gated editor. Also, the automation "New
automation" template picker (`automation-frontend`) gated its page on the bare
global manage rule; it now uses the create capability, so a team-scoped creator
(whom the route already reveals the page to) is no longer shown a blocked page.

Incident & maintenance: `removeLink` was `global: true` because its input carried
only the link id. It now takes the owning `incidentId` / `maintenanceId`
(mirroring `addLink`), authorizes per-instance via `idParam`, and the service
scopes the delete by that parent id so a link cannot be removed by pairing its id
with a different incident/maintenance the caller manages. The AI `removeLink`
tools carry the parent id too.

BREAKING CHANGES: `automation.getRun`, `automation.cancelRun`,
`automation.getRunScopeForReplay`, `incident.removeLink`, and
`maintenance.removeLink` now require a parent id (`automationId` /
`incidentId` / `maintenanceId`) in their input. Endpoints previously gated by a
global rule alone now also accept the owning team's grant; no endpoint became
more permissive for a user who lacks both the global rule and a relevant team
grant.

Not team-scopable, so intentionally left `global: true` (verified by the audit):
catalog environments, anomaly config, SLO list/streak/milestone reads and
health-check history/stats (their read rules are public/default), and every
hand-rolled HTTP route (global admin/infra or already team-aware).
