---
"@checkstack/auth-backend": minor
"@checkstack/auth-frontend": minor
"@checkstack/auth-common": minor
"@checkstack/backend": minor
"@checkstack/backend-api": minor
"@checkstack/common": minor
"@checkstack/catalog-common": minor
"@checkstack/catalog-frontend": minor
"@checkstack/dashboard-frontend": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/incident-backend": minor
"@checkstack/incident-common": minor
"@checkstack/incident-frontend": minor
"@checkstack/maintenance-backend": minor
"@checkstack/maintenance-common": minor
"@checkstack/maintenance-frontend": minor
---

# Teams and Resource-Level Access Control

This release introduces a comprehensive Teams system for organizing users and controlling access to resources at a granular level.

## Features

### Team Management
- Create, update, and delete teams with name and description
- Add/remove users from teams
- Designate team managers with elevated privileges
- View team membership and manager status

### Resource-Level Access Control
- Grant teams access to specific resources (systems, health checks, incidents, maintenances)
- Configure read-only or manage permissions per team
- Resource-level "Team Only" mode that restricts access exclusively to team members
- Separate `resourceAccessSettings` table for resource-level settings (not per-grant)
- Automatic cleanup of grants when teams are deleted (database cascade)

### Middleware Integration
- Extended `autoAuthMiddleware` to support resource access checks
- Single-resource pre-handler validation for detail endpoints
- Automatic list filtering for collection endpoints
- S2S endpoints for access verification

### Frontend Components
- `TeamsTab` component for managing teams in Auth Settings
- `TeamAccessEditor` component for assigning team access to resources
- Resource-level "Team Only" toggle in `TeamAccessEditor`
- Integration into System, Health Check, Incident, and Maintenance editors

## Breaking Changes

### API Response Format Changes
List endpoints now return objects with named keys instead of arrays directly:

```typescript
// Before
const systems = await catalogApi.getSystems();

// After
const { systems } = await catalogApi.getSystems();
```

Affected endpoints:
- `catalog.getSystems` → `{ systems: [...] }`
- `healthcheck.getConfigurations` → `{ configurations: [...] }`
- `incident.listIncidents` → `{ incidents: [...] }`
- `maintenance.listMaintenances` → `{ maintenances: [...] }`

### User Identity Enrichment
`RealUser` and `ApplicationUser` types now include `teamIds: string[]` field with team memberships.

## Documentation
See `docs/backend/teams.md` for complete API reference and integration guide.
