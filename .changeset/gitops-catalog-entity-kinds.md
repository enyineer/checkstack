---
"@checkstack/catalog-backend": minor
"@checkstack/gitops-backend": patch
---

Register catalog System and Group as GitOps entity kinds

- **catalog-backend**: Registers `kind: System` and `kind: Group` with the GitOps Entity Kind Registry. The catalog now supports declarative management via YAML descriptors in Git repositories. Systems and groups are reconciled using the `metadata.gitops_entity_name` marker for cross-sync identity lookup.
- **gitops-backend**: Wires up the delete reconciler for orphan cleanup — both automatic deletion (via `deletionPolicy: "auto"`) and manual orphan confirmation now invoke the owning plugin's `delete()` handler before removing provenance entries.
