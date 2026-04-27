---
"@checkstack/gitops-backend": patch
"@checkstack/healthcheck-backend": patch
---

Fix GitOps entity update failures due to pending error records

- Ensured the `existingEntityId` parameter in the Reconciler engine is set to `undefined` instead of a `"pending-UUID"` when handling entities that failed to sync initially.
- Hardened the `Healthcheck` GitOps kind logic to explicitly ignore `"pending-"` IDs, preventing SQL update errors on synthetic provenance IDs.
- Fixed a bug where resolving YAML syntax errors would cause the subsequent sync to fail with `failed query: update [...]` because it attempted to update the nonexistent `"pending-"` entity instead of creating a new one.
