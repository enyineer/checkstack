---
"@checkstack/incident-backend": minor
---

Add an `incident` artifact type to the incident automation actions (Phase 20 prerequisite).

Closes GAP 2 from the Phase 20 analysis - a single automation can now open an incident and reference it downstream (open then wait then resolve) without the operator repeating the id.

- New `incident` artifact type registered in incident-backend (`{ incidentId, status, severity, systemIds }`).
- `incident.create` now declares `produces: "incident"`, so the created incident is queryable in run scope (mirrors the Jira `produces: "jira.issue"` pattern).
- `incident.resolve` / `incident.add_update` / `incident.update_status` now declare `consumes: ["incident"]` and make their `incidentId` config optional, falling back to the upstream `incident` artifact (config takes priority, else artifact - the `resolveIssueKey` pattern). They fail with a clear error when neither is present.
