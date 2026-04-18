---
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/backend-api": minor
"@checkstack/healthcheck-dns-backend": patch
"@checkstack/healthcheck-grpc-backend": patch
"@checkstack/healthcheck-http-backend": patch
"@checkstack/healthcheck-jenkins-backend": patch
"@checkstack/healthcheck-mysql-backend": patch
"@checkstack/healthcheck-ping-backend": patch
"@checkstack/healthcheck-postgres-backend": patch
"@checkstack/healthcheck-rcon-backend": patch
"@checkstack/healthcheck-redis-backend": patch
"@checkstack/healthcheck-script-backend": patch
"@checkstack/healthcheck-ssh-backend": patch
"@checkstack/healthcheck-tcp-backend": patch
"@checkstack/healthcheck-tls-backend": patch
---

### Health Check Editor Redesign — IDE-Style Experience

Replaces the modal-based health check editor with a full-page, IDE-style experience:

- **Strategy Picker Page**: New `/config/create` page with categorized strategy discovery, search filtering, and grouped card grid layout
- **IDE Editor Page**: New `/config/:configId/edit` page with a split-view layout — explorer tree on the left, editor panel on the right
- **Strategy Categories**: Introduces `StrategyCategory` enum with 16 categories (Networking, Database, Infrastructure, etc.) — all 13 strategy plugins now declare their category
- **New RPC Endpoint**: Added `getConfiguration` (singular by ID) for efficient single-resource fetching on the edit page
- **Explorer Tree**: Left-hand navigation with General, Check Items (collectors), and Access Control sections, with real-time validation indicators
- **Validation Status Bar**: Bottom bar showing aggregated validation issues with clickable navigation
- **Unsaved Changes Guard**: Browser `beforeunload` protection when the form is dirty
- **Responsive Design**: Split-view on desktop, stacked layout on mobile
- **Deleted**: Legacy `HealthCheckEditor.tsx` modal component
