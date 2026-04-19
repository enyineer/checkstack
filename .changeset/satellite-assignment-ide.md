---
"@checkstack/ui": minor
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/satellite-backend": minor
"@checkstack/satellite-common": minor
"@checkstack/satellite-frontend": minor
"@checkstack/satellite": minor
"@checkstack/backend": minor
"@checkstack/backend-api": minor
---

Distributed satellite health checks and Assignment IDE page

**Satellite System**
- New `satellite-backend`, `satellite-common`, `satellite-frontend`, and `satellite` agent packages for distributed health check execution
- WebSocket-based satellite connectivity with authentication, heartbeats, and live configuration push
- Satellite management UI with create dialog, status badges, and list page

**Live Configuration Updates**
- Added `assignmentChanged` hook to `healthcheck-backend` for cross-plugin communication
- `satellite-backend` subscribes to assignment changes and pushes config updates to connected satellites in real-time

**Assignment IDE Page**
- Replaced the 1028-line modal-based `SystemHealthCheckAssignment` component with a full-page IDE layout
- New modular components: `AssignmentTree`, `GeneralPanel`, `ThresholdsPanel`, `RetentionPanel`, `ExecutionPanel`
- Added unassign capability and sorted assignment lists for stable ordering

**Shared IDE Primitives**
- Extracted `IDETreeNode`, `IDETreeSection`, `IDEStatusBar`, `IDELayout` to `@checkstack/ui` for cross-plugin reuse
- Migrated existing health check IDE editor to use shared primitives

**Infrastructure**
- Added `Dockerfile.satellite` for containerized satellite deployment
- WebSocket route registry in `@checkstack/backend` and `@checkstack/backend-api`
