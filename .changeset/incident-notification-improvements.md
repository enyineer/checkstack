---
"@checkstack/incident-backend": minor
"@checkstack/maintenance-backend": patch
---

### @checkstack/incident-backend

Added notifications for incident status changes via the "Add Update" functionality:
- Notifications are now sent when an incident is reopened (status changed from resolved)
- Notifications are now sent when an incident status changes to any new value
- Notifications are now sent when an incident is resolved via addUpdate
- Extracted `notifyAffectedSystems` into a reusable module with proper importance logic:
  - Resolved incidents always use "info" importance (good news)
  - Reopened/created/updated incidents derive importance from severity

### @checkstack/maintenance-backend

Fixed missing notification in `closeMaintenance` handler - the "Close" button now sends a "completed" notification to subscribers.
