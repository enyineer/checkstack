---
"@checkstack/gitops-common": minor
"@checkstack/gitops-backend": minor
"@checkstack/gitops-frontend": minor
"@checkstack/healthcheck-backend": minor
---

Added `registerSpecSchemaDocumentation` to EntityKindRegistry to allow plugins to provide detailed JSON Schemas for specific configurations. The frontend now displays these registered schemas as dropdown alternatives, improving the developer experience when authoring GitOps configurations.
