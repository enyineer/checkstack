---
"@checkmate-monitor/maintenance-common": minor
"@checkmate-monitor/maintenance-backend": minor
"@checkmate-monitor/maintenance-frontend": minor
"@checkmate-monitor/ui": patch
---

Add standalone maintenance scheduling plugin

- New `@checkmate-monitor/maintenance-common` package with Zod schemas, permissions, oRPC contract, and extension slots
- New `@checkmate-monitor/maintenance-backend` package with Drizzle schema, service, and oRPC router
- New `@checkmate-monitor/maintenance-frontend` package with admin page and system detail panel
- Shared `DateTimePicker` component added to `@checkmate-monitor/ui`
- Database migrations for maintenances, maintenance_systems, and maintenance_updates tables
