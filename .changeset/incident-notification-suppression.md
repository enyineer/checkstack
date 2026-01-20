---
"@checkstack/incident-backend": minor
"@checkstack/incident-common": minor
"@checkstack/incident-frontend": minor
"@checkstack/healthcheck-backend": minor
---

Add notification suppression for incidents

- Added `suppressNotifications` field to incidents, allowing active incidents to optionally suppress health check notifications
- When enabled, health status change notifications will not be sent for affected systems while the incident is active (not resolved)
- Mirrors the existing maintenance notification suppression pattern
- Added toggle UI in the IncidentEditor dialog
- Added `hasActiveIncidentWithSuppression` RPC endpoint for service-to-service queries
