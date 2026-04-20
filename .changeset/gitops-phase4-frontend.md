---
"@checkstack/gitops-common": minor
"@checkstack/gitops-backend": minor
"@checkstack/gitops-frontend": minor
"@checkstack/catalog-backend": minor
"@checkstack/catalog-frontend": minor
---

Generalized provenance system and GitOps frontend plugin

**Breaking**: `EntityKindDefinition.reconcile()` now returns `{ entityId: string }` instead of `void`. Plugins must return the plugin-specific entity ID (e.g., catalog system UUID) so the engine can store it in provenance.

- Added `entityId` column to the provenance table (non-nullable)
- Reconciler engine passes `existingEntityId` to plugins for updates
- `getProvenance` now supports lookup by `entityId` in addition to `entityName`
- Added provider CRUD endpoints: `createProvider`, `updateProvider`, `deleteProvider`
- Created `gitops-frontend` plugin with provider management, secret management, and sync status dashboard
- Removed `gitops_entity_name` metadata markers from catalog entities
- Removed `findSystemByGitOpsName`, `deleteSystemByGitOpsName` (and Group equivalents) from EntityService
- Added provenance-based UI locking in catalog-frontend: edit/delete/drag disabled for GitOps-managed systems and groups
