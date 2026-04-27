---
"@checkstack/gitops-backend": patch
---

Fix GitOps engine skipping retry of failed entities

- Updated the fast-path condition in the Reconciler engine to only skip reconciliation if the entity is in a `synced` state. 
- Prevents entities from remaining permanently stuck in an error state without being retried if the underlying YAML file is not modified.
