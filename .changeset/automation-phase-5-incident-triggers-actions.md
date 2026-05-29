---
"@checkstack/incident-backend": minor
---

feat(incident): register incident lifecycle as automation triggers + actions

Adds three triggers (`incident.created`, `incident.updated`,
`incident.resolved`) backed by the existing hooks, each exposing
`incidentId` as the context key so `wait_for_trigger` waits match the
same incident across the run. Adds four actions (`incident.create`,
`incident.resolve`, `incident.add_update`, `incident.update_status`)
wrapping the existing `IncidentService` methods so operators can compose
incident flows in the Automation editor.
