---
"@checkmate-monitor/incident-common": minor
"@checkmate-monitor/maintenance-common": minor
"@checkmate-monitor/catalog-common": minor
"@checkmate-monitor/healthcheck-common": minor
"@checkmate-monitor/integration-common": minor
---

Enable external application (API key) access to management endpoints

Changed `userType: "user"` to `userType: "authenticated"` for 52 endpoints across 5 packages, allowing external applications (service accounts with API keys) to call these endpoints programmatically while maintaining RBAC permission checks:

- **incident-common**: createIncident, updateIncident, addUpdate, resolveIncident, deleteIncident
- **maintenance-common**: createMaintenance, updateMaintenance, addUpdate, closeMaintenance, deleteMaintenance
- **catalog-common**: System CRUD, Group CRUD, addSystemToGroup, removeSystemFromGroup
- **healthcheck-common**: Configuration management, system associations, retention config, detailed history
- **integration-common**: Subscription management, connection management, event discovery, delivery logs

This enables automation use cases such as:
- Creating incidents from external monitoring systems (Prometheus, Grafana)
- Scheduling maintenances from CI/CD pipelines
- Managing catalog systems from infrastructure-as-code tools
- Configuring health checks from deployment scripts
