---
"@checkstack/ai-backend": minor
"@checkstack/maintenance-backend": minor
"@checkstack/maintenance-common": minor
"@checkstack/maintenance-frontend": patch
---

feat(ai): add the system.issues aggregator tool and system-signals extension point

`ai-backend` gains a new read tool, `system.issues`, that returns ALL current
system issues - failing health checks, breaching or at-risk SLOs, active
anomalies, open incidents, active maintenances, and dependency problems -
aggregated across every system in ONE call. The assistant is steered to reach
for it FIRST whenever asked whether there are issues, what is down, or for an
overall health overview, instead of polling each per-domain tool. The tool is
gated by `catalog.system.read`.

The tool owns no domain knowledge. A new backend `systemSignalsExtensionPoint`
lets any plugin register ONE `SystemSignalsContributor` from its own `init`; the
tool fans out across every contributor and merges their per-system maps. Each
contributor enforces its OWN per-source access gate - returning an empty map
(never throwing) when the principal lacks access - and reads from shared, durable
storage so the answer is identical on every pod. `ai-backend` imports no
capability plugin's `*-common` to collect signals; the dependency direction stays
plugin -> `@checkstack/ai-backend`.

The maintenance plugin now registers a `system.issues` contributor (sourceId
`maintenance`) from its backend `init`, surfacing in-progress maintenances
alongside the other sources. The contributor enforces its own
`maintenance.read` gate and reads active maintenances for all systems globally
via a new `getActiveMaintenancesBySystem` service method. The row->signal mapping
is extracted into a new pure `deriveMaintenanceSignals` deriver in
`@checkstack/maintenance-common`, shared by the backend contributor and the
frontend `MaintenanceSignalsFiller` so the two surfaces stay in lockstep.

The new `systemSignalsExtensionPoint`, `SystemSignalsContributor`,
`SystemSignalsExtensionPoint`, and the `system.issues` tool factory plus its
pure helpers (`mergeSystemSignalsMaps`, `collectSystemSignals`,
`toSystemIssuesOutput`, schemas) are exported from `@checkstack/ai-backend`.
