---
"@checkstack/maintenance-common": minor
"@checkstack/maintenance-backend": minor
"@checkstack/maintenance-frontend": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/backend": patch
---

Add notification suppression toggle for maintenance windows

**New Feature:** When creating or editing a maintenance window, you can now enable "Suppress health notifications" to prevent health status change notifications from being sent for affected systems while the maintenance is active (in_progress status). This is useful for planned downtime where health alerts are expected and would otherwise create noise.

**Changes:**
- Added `suppressNotifications` field to maintenance schema
- Added new service-to-service API `hasActiveMaintenanceWithSuppression`
- Healthcheck queue executor now checks for suppression before sending notifications
- MaintenanceEditor UI includes new toggle checkbox

**Bug Fix:** Fixed migration system to correctly set PostgreSQL search_path when running plugin migrations. Previously, migrations could fail with "relation does not exist" errors because the schema context wasn't properly set.
