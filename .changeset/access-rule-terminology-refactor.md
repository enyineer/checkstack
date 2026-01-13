---
"@checkstack/api-docs-common": minor
"@checkstack/api-docs-frontend": minor
"@checkstack/auth-backend": minor
"@checkstack/auth-common": minor
"@checkstack/auth-frontend": minor
"@checkstack/backend": minor
"@checkstack/backend-api": minor
"@checkstack/catalog-backend": minor
"@checkstack/catalog-common": minor
"@checkstack/catalog-frontend": minor
"@checkstack/command-backend": minor
"@checkstack/command-common": minor
"@checkstack/command-frontend": minor
"@checkstack/common": minor
"@checkstack/frontend": minor
"@checkstack/frontend-api": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/incident-backend": minor
"@checkstack/incident-common": minor
"@checkstack/incident-frontend": minor
"@checkstack/integration-backend": minor
"@checkstack/integration-common": minor
"@checkstack/integration-frontend": minor
"@checkstack/integration-jira-common": minor
"@checkstack/maintenance-backend": minor
"@checkstack/maintenance-common": minor
"@checkstack/maintenance-frontend": minor
"@checkstack/notification-backend": minor
"@checkstack/notification-common": minor
"@checkstack/notification-frontend": minor
"@checkstack/queue-backend": minor
"@checkstack/queue-bullmq-backend": minor
"@checkstack/queue-bullmq-common": minor
"@checkstack/queue-common": minor
"@checkstack/queue-frontend": minor
"@checkstack/queue-memory-backend": minor
"@checkstack/queue-memory-common": minor
"@checkstack/scripts": minor
"@checkstack/signal-backend": minor
"@checkstack/signal-common": minor
"@checkstack/test-utils-backend": minor
"@checkstack/theme-backend": minor
"@checkstack/ui": minor
---

# Unified AccessRule Terminology Refactoring

This release completes a comprehensive terminology refactoring from "permission" to "accessRule" across the entire codebase, establishing a consistent and modern access control vocabulary.

## Changes

### Core Infrastructure (`@checkstack/common`)
- Introduced `AccessRule` interface as the primary access control type
- Added `accessPair()` helper for creating read/manage access rule pairs
- Added `access()` builder for individual access rules
- Replaced `Permission` type with `AccessRule` throughout

### API Changes
- `env.registerPermissions()` → `env.registerAccessRules()`
- `meta.permissions` → `meta.access` in RPC contracts
- `usePermission()` → `useAccess()` in frontend hooks
- Route `permission:` field → `accessRule:` field

### UI Changes
- "Roles & Permissions" tab → "Roles & Access Rules"
- "You don't have permission..." → "You don't have access..."
- All permission-related UI text updated

### Documentation & Templates
- Updated 18 documentation files with AccessRule terminology
- Updated 7 scaffolding templates with `accessPair()` pattern
- All code examples use new AccessRule API

## Migration Guide

### Backend Plugins
```diff
- import { permissionList } from "./permissions";
- env.registerPermissions(permissionList);
+ import { accessRules } from "./access";
+ env.registerAccessRules(accessRules);
```

### RPC Contracts
```diff
- .meta({ userType: "user", permissions: [permissions.read.id] })
+ .meta({ userType: "user", access: [access.read] })
```

### Frontend Hooks
```diff
- const canRead = accessApi.usePermission(permissions.read.id);
+ const canRead = accessApi.useAccess(access.read);
```

### Routes
```diff
- permission: permissions.entityRead.id,
+ accessRule: access.read,
```
