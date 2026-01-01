---
"@checkmate/maintenance-common": minor
"@checkmate/maintenance-backend": minor
"@checkmate/maintenance-frontend": minor
"@checkmate/ui": patch
---

Add standalone maintenance scheduling plugin

- New `@checkmate/maintenance-common` package with Zod schemas, permissions, oRPC contract, and extension slots
- New `@checkmate/maintenance-backend` package with Drizzle schema, service, and oRPC router
- New `@checkmate/maintenance-frontend` package with admin page and system detail panel
- Shared `DateTimePicker` component added to `@checkmate/ui`
- Database migrations for maintenances, maintenance_systems, and maintenance_updates tables
