---
"@checkmate-monitor/healthcheck-backend": minor
"@checkmate-monitor/catalog-backend": minor
"@checkmate-monitor/integration-backend": minor
"@checkmate-monitor/auth-backend": minor
"@checkmate-monitor/healthcheck-frontend": minor
"@checkmate-monitor/catalog-frontend": minor
"@checkmate-monitor/integration-frontend": minor
"@checkmate-monitor/auth-frontend": minor
"@checkmate-monitor/command-backend": minor
---

Add command palette commands and deep-linking support

**Backend Changes:**
- `healthcheck-backend`: Add "Manage Health Checks" (⇧⌘H) and "Create Health Check" commands
- `catalog-backend`: Add "Manage Systems" (⇧⌘S) and "Create System" commands
- `integration-backend`: Add "Manage Integrations" (⇧⌘G), "Create Integration Subscription", and "View Integration Logs" commands
- `auth-backend`: Add "Manage Users" (⇧⌘U), "Create User", "Manage Roles", and "Manage Applications" commands
- `command-backend`: Auto-cleanup command registrations when plugins are deregistered

**Frontend Changes:**
- `HealthCheckConfigPage`: Handle `?action=create` URL parameter
- `CatalogConfigPage`: Handle `?action=create` URL parameter
- `IntegrationsPage`: Handle `?action=create` URL parameter
- `AuthSettingsPage`: Handle `?tab=` and `?action=create` URL parameters
