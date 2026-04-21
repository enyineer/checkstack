---
"@checkstack/gitops-common": minor
"@checkstack/gitops-backend": minor
"@checkstack/gitops-frontend": minor
---

Add Kind Registry browser and developer documentation

- Added `gitopsAccess.kinds.read` access rule for standalone Kind Registry access
- Added `describeKinds()` method to the internal entity kind registry, serializing Zod schemas to JSON Schema
- Added `listKinds` RPC endpoint gated by the new access rule
- Created standalone Kind Registry page with schema visualization, extension listing, and auto-generated YAML examples
- Added Kind Registry link to the user menu
- Created developer documentation for entity kind and extension registration in `docs/backend/gitops-entity-kinds.md`
