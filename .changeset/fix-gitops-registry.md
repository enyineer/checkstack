---
"@checkstack/gitops-backend": patch
"@checkstack/gitops-frontend": patch
"@checkstack/healthcheck-backend": patch
---

Fix GitOps Healthcheck reconciliation engine and Kind Registry UI

- Mandated fully qualified IDs for all healthcheck strategies and collector definitions.
- Refactored the Kind Registry UI to display schema documentation in beautifully formatted, interactive YAML examples.
- Entity Envelope Fields and Base Spec Schema are now displayed in collapsed accordions.
- Fixed condition logic that broke the collector documentation display.
- Enhanced UX by dynamically injecting fully-qualified strategy variants directly into the YAML examples.
