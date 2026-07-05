---
"@checkstack/incident-common": minor
"@checkstack/incident-backend": minor
"@checkstack/incident-frontend": minor
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-frontend": minor
---

Incidents can now optionally override the health status of their affected
systems. When creating or editing an incident you can pick "Override system
health" (Degraded or Unhealthy); while the incident is active (not resolved)
that status is folded into every affected system's derived health via
worst-wins, so it shows on every health surface (status pages, dashboards,
dependency map, catalog badges). A health check reporting a worse status still
wins, and the override lifts automatically when the incident resolves. This
covers components that no automated check can monitor (e.g. a running app whose
licenses were revoked so it won't open).

The override is a deliberate operator choice, independent of the incident's
severity. A new service-typed incident RPC `getActiveHealthOverrides` exposes
active overrides per system, which `@checkstack/healthcheck-backend` reads and
folds into `getSystemHealthStatus`. The system-health response gains an optional
`override` field naming the contributing incident so UIs can explain why a
system reads unhealthy when its checks look fine. The system health badge uses
it to show, on hover, when a status was forced by an incident.

The dashboard "problem system" signal attributes an override-forced status to
the incident ("Forced by incident: <title>") instead of misreporting
"0 of N checks failing", while a genuinely worse health check still drives the
signal and its detail. Public status pages reflect the forced status but never
carry the incident title (the widget DTOs project only the status), so an
override cannot leak the name of a hidden incident.

Behavior change: a system's derived health now reflects active incident
overrides in addition to its health checks. Adds a forward-only migration for
the new nullable `incidents.health_override` column.
